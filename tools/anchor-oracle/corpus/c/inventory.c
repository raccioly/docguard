/*
 * In-memory stock ledger loaded from "sku;location;unit;qty;reorder;cost"
 * exports, where unit is "ea", "g" or "ml" and '#' starts a comment line.
 */
#include <errno.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SKU_MAX_LEN       24
#define LOCATION_CODE_LEN 8
#define LINE_BUFFER_SIZE  256
#define ITEM_FLAG_HAZMAT  0x02u

#define INV_LOG(level, fmt, ...)                                       \
    fprintf(stderr, "[inventory %s] " fmt "\n", (level), __VA_ARGS__)

#define INV_REQUIRE(cond, code)                                        \
    do {                                                               \
        if (!(cond)) {                                                 \
            rc = (code);                                               \
            goto cleanup;                                              \
        }                                                              \
    } while (0)

#define DEFINE_COUNTER(name)                                           \
    static struct event_counter name = { .label = #name, .value = 0 }

struct event_counter {
    const char *label;
    unsigned long value;
};

DEFINE_COUNTER(loaded_records);
DEFINE_COUNTER(rejected_records);

enum unit_kind {
    UNIT_EACH,
    UNIT_GRAMS,
    UNIT_MILLILITRES,
};

/* each, grams and millilitres all live at offset 0 of the union. */
struct quantity {
    enum unit_kind kind;
    union {
        uint32_t each;
        struct {
            uint32_t grams;
            uint16_t tolerance_pct;
        };
        uint32_t millilitres;
    };
};

struct stock_item {
    char sku[SKU_MAX_LEN + 1];
    char location[LOCATION_CODE_LEN + 1];
    struct quantity on_hand;
    struct quantity reorder_point;
    uint32_t unit_cost_cents;
    unsigned int flags;
};

_Static_assert(sizeof(((struct stock_item *)0)->sku) > SKU_MAX_LEN,
               "sku buffer must leave room for the terminator");

struct inventory {
    struct stock_item *items;
    size_t count;
    size_t capacity;
};

static const struct stock_item seed_items[] = {
    {
        .sku = "BOLT-M6-20",
        .location = "A01-03",
        .on_hand = { .kind = UNIT_EACH, .each = 1200 },
        .reorder_point = { .kind = UNIT_EACH, .each = 300 },
        .unit_cost_cents = 4,
    },
    {
        .sku = "GREASE-LITH-1KG",
        .location = "C12-01",
        .on_hand = { .kind = UNIT_GRAMS, .grams = 8500, .tolerance_pct = 2 },
        .reorder_point = { .kind = UNIT_GRAMS, .grams = 2000 },
        .flags = ITEM_FLAG_HAZMAT,
    },
};

#if defined(INVENTORY_DEBUG) && INVENTORY_DEBUG > 1
static void trace_item(const char *what, const struct stock_item *item)
{
    fprintf(stderr, "%s {sku=\"%s\", loc=\"%s\", flags=0x%02x}\n",
            what, item->sku, item->location, item->flags);
}
#else
#define trace_item(what, item) ((void)(what), (void)(item))
#endif

static uint64_t
quantity_base_units(const struct quantity *q)
{
    switch (q->kind) {
    case UNIT_EACH:
        return q->each;
    case UNIT_GRAMS:
        return q->grams;
    case UNIT_MILLILITRES:
        return q->millilitres;
    }
    return 0;
}

int inventory_add(struct inventory *inv, const struct stock_item *item)
{
    if (inv->count == inv->capacity) {
        size_t next = inv->capacity ? inv->capacity * 2 : 16;
        struct stock_item *grown = realloc(inv->items, next * sizeof *grown);
        if (grown == NULL) {
            return -ENOMEM;
        }
        inv->items = grown;
        inv->capacity = next;
    }
    trace_item("add", item);
    inv->items[inv->count++] = *item;
    return 0;
}

int inventory_seed_defaults(struct inventory *inv)
{
    for (size_t i = 0; i < sizeof seed_items / sizeof seed_items[0]; i++) {
        int rc = inventory_add(inv, &seed_items[i]);
        if (rc != 0) {
            return rc;
        }
    }
    return 0;
}

static bool needs_reorder(const struct stock_item *item)
{
    return quantity_base_units(&item->on_hand) <
           quantity_base_units(&item->reorder_point);
}

static int parse_record(const char *line, struct stock_item *item)
{
    unsigned long qty, reorder, cost;
    enum unit_kind kind;
    char unit[4];

    if (sscanf(line, "%24[^;];%8[^;];%3[^;];%lu;%lu;%lu",
               item->sku, item->location, unit, &qty, &reorder, &cost) != 6) {
        return -EINVAL;
    }
    if (strcmp(unit, "ea") == 0) {
        kind = UNIT_EACH;
    } else if (strcmp(unit, "g") == 0) {
        kind = UNIT_GRAMS;
    } else if (strcmp(unit, "ml") == 0) {
        kind = UNIT_MILLILITRES;
    } else {
        return -EINVAL;
    }
    if (qty > UINT32_MAX || reorder > UINT32_MAX || cost > UINT32_MAX) {
        return -ERANGE;
    }
    item->on_hand = (struct quantity){ .kind = kind, .each = (uint32_t)qty };
    item->reorder_point = (struct quantity){ .kind = kind, .each = (uint32_t)reorder };
    item->unit_cost_cents = (uint32_t)cost;
    return 0;
}

int inventory_load(struct inventory *inv, const char *path)
{
    int rc = 0;
    size_t line_no = 0;
    char *line = NULL;
    FILE *fp = fopen(path, "r");

    INV_REQUIRE(fp != NULL, -errno);
    line = malloc(LINE_BUFFER_SIZE);
    INV_REQUIRE(line != NULL, -ENOMEM);

    while (fgets(line, LINE_BUFFER_SIZE, fp) != NULL) {
        struct stock_item item = { 0 };

        line_no++;
        if (line[0] == '#' || line[0] == '\n') {
            continue;
        }
        if (parse_record(line, &item) != 0) {
            INV_LOG("warn", "%s:%zu: malformed record skipped", path, line_no);
            rejected_records.value++;
            continue;
        }
        rc = inventory_add(inv, &item);
        INV_REQUIRE(rc == 0, rc);
        loaded_records.value++;
    }
    INV_REQUIRE(!ferror(fp), -EIO);

cleanup:
    free(line);
    if (fp != NULL) {
        fclose(fp);
    }
    return rc;
}

int inventory_write_report(const struct inventory *inv, FILE *out)
{
    static const char *const unit_labels[] = {
        [UNIT_EACH] = "each",
        [UNIT_GRAMS] = "g",
        [UNIT_MILLILITRES] = "ml",
    };

    if (fputs("{\"items\":[", out) == EOF) {
        return -EIO;
    }
    for (size_t i = 0; i < inv->count; i++) {
        const struct stock_item *it = &inv->items[i];
        if (fprintf(out,
                    "%s{\"sku\":\"%s\",\"qty\":%" PRIu64 ",\"unit\":\"%s\",\"low\":%s}",
                    i ? "," : "",
                    it->sku,
                    quantity_base_units(&it->on_hand),
                    unit_labels[it->on_hand.kind],
                    needs_reorder(it) ? "true" : "false") < 0) {
            return -EIO;
        }
    }
    if (fprintf(out, "],\"%s\":%lu,\"%s\":%lu}\n",
                loaded_records.label, loaded_records.value,
                rejected_records.label, rejected_records.value) < 0) {
        return -EIO;
    }
    return 0;
}
