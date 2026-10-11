#include "ring_buffer.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define RB_CHECK(rb)                        \
    do {                                    \
        if ((rb) == NULL) {                 \
            return RB_ERR_INVALID;          \
        }                                   \
    } while (0)

static void free_drop(void *item, void *ctx)
{
    (void)ctx;
    free(item);
}

/* Returns the built-in drop handler named by mode, or NULL for "none". */
static void (*select_drop_handler(const char *mode))(void *, void *)
{
    return strcmp(mode, "free") == 0 ? free_drop : NULL;
}

rb_status rb_init(ring_buffer *rb, size_t capacity, rb_overflow_policy policy)
{
    RB_CHECK(rb);

    if (capacity == 0) {
        capacity = RB_DEFAULT_CAPACITY;
    }
    if (capacity > RB_MAX_CAPACITY) {
        return RB_ERR_INVALID;
    }

    size_t rounded = 1;
    while (rounded < capacity) {
        rounded <<= 1;
    }
    void **slots = calloc(rounded, sizeof *slots);
    if (slots == NULL) {
        return RB_ERR_NOMEM;
    }

    *rb = (ring_buffer){
        .slots = slots,
        .capacity = rounded,
        .mask = rounded - 1,
        .policy = policy,
    };
    return RB_OK;
}

void rb_destroy(ring_buffer *rb)
{
    void *item;

    if (rb == NULL) {
        return;
    }
    while (rb_pop(rb, &item) == RB_OK) {
        if (rb->on_drop != NULL) {
            rb->on_drop(item, rb->drop_ctx);
        }
    }
    free(rb->slots);
    memset(rb, 0, sizeof *rb);
}

rb_status rb_push(ring_buffer *rb, void *item)
{
    RB_CHECK(rb);

    if (rb_size(rb) == rb->capacity) {
        if (rb->policy == RB_POLICY_REJECT) {
            return RB_ERR_FULL;
        }
        void *victim = rb->slots[rb->tail++ & rb->mask];
        rb->stats.dropped++;
        if (rb->on_drop != NULL) {
            rb->on_drop(victim, rb->drop_ctx);
        }
    }
    rb->slots[rb->head++ & rb->mask] = item;
    rb->stats.pushed++;
    return RB_OK;
}

rb_status rb_pop(ring_buffer *rb, void **out)
{
    RB_CHECK(rb);

    if (rb_empty(rb)) {
        return RB_ERR_EMPTY;
    }
    void **slot = &rb->slots[rb->tail++ & rb->mask];
    if (out != NULL) {
        *out = *slot;
    }
    *slot = NULL;
    rb->stats.popped++;
    return RB_OK;
}

size_t rb_drain(ring_buffer *rb,
                void **out,
                size_t max_items)
{
    size_t n = 0;

    while (n < max_items && rb_pop(rb, &out[n]) == RB_OK) {
        n++;
    }
    return n;
}

int rb_visit(const ring_buffer *rb, rb_visit_fn visit, void *ctx)
{
    void *item;

    RB_FOREACH(rb, i, item) {
        int rc = visit(item, i, ctx);
        if (rc != 0) {
            return rc;
        }
    }
    return 0;
}

rb_status rb_configure_drop(ring_buffer *rb, const char *mode)
{
    RB_CHECK(rb);

    void (*handler)(void *, void *) = select_drop_handler(mode);
    if (handler == NULL && strcmp(mode, "none") != 0) {
        return RB_ERR_INVALID;
    }
    rb->on_drop = handler;
    rb->drop_ctx = NULL;
    return RB_OK;
}

#ifdef RB_ENABLE_TRACE
void rb_trace(const ring_buffer *rb, const char *label)
{
    fprintf(stderr,
            "{\"rb\":\"%s\",\"size\":%zu,\"cap\":%zu,\"dropped\":%llu}\n",
            label,
            rb_size(rb),
            rb->capacity,
            (unsigned long long)rb->stats.dropped);
}
#endif
