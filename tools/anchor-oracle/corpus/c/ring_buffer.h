/*
 * Fixed-capacity FIFO of opaque pointers. Capacity is rounded up to a power
 * of two; head and tail are free-running counters whose difference is the
 * number of queued items, which stays correct across unsigned wrap-around.
 */
#ifndef RING_BUFFER_H
#define RING_BUFFER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define RB_DEFAULT_CAPACITY 256u
#define RB_MAX_CAPACITY     (1u << 20)

/* Iterates oldest to newest without consuming. Do not push or pop inside. */
#define RB_FOREACH(rb, idx, item)                                   \
    for (size_t idx = 0;                                            \
         (idx) < rb_size(rb) &&                                     \
         ((item) = rb_peek_at((rb), (idx)), 1);                     \
         ++(idx))

typedef enum rb_status {
    RB_OK = 0,
    RB_ERR_FULL,
    RB_ERR_EMPTY,
    RB_ERR_NOMEM,
    RB_ERR_INVALID
} rb_status;

typedef enum {
    RB_POLICY_REJECT,
    RB_POLICY_OVERWRITE_OLDEST
} rb_overflow_policy;

typedef void (*rb_drop_fn)(void *item, void *ctx);
typedef int (*rb_visit_fn)(const void *item, size_t index, void *ctx);

typedef struct ring_buffer {
    void **slots;
    size_t capacity;
    size_t mask;
    size_t head;
    size_t tail;
    rb_overflow_policy policy;
    rb_drop_fn on_drop;
    void *drop_ctx;
    struct rb_stats {
        uint64_t pushed;
        uint64_t popped;
        uint64_t dropped;
    } stats;
} ring_buffer;

rb_status rb_init(ring_buffer *rb, size_t capacity, rb_overflow_policy policy);
void rb_destroy(ring_buffer *rb);
rb_status rb_push(ring_buffer *rb, void *item);
rb_status rb_pop(ring_buffer *rb, void **out);
extern size_t rb_drain(ring_buffer *rb,
                       void **out,
                       size_t max_items);
int rb_visit(const ring_buffer *rb, rb_visit_fn visit, void *ctx);
rb_status rb_configure_drop(ring_buffer *rb, const char *mode);

static inline size_t rb_size(const ring_buffer *rb)
{
    return rb->head - rb->tail;
}

static inline bool rb_empty(const ring_buffer *rb) { return rb->head == rb->tail; }

static inline void *
rb_peek_at(const ring_buffer *rb, size_t offset)
{
    return rb->slots[(rb->tail + offset) & rb->mask];
}

#ifdef RB_ENABLE_TRACE
void rb_trace(const ring_buffer *rb, const char *label);
#else
static inline void rb_trace(const ring_buffer *rb, const char *label)
{
    (void)rb;
    (void)label;
}
#endif

#ifdef __cplusplus
}
#endif

#endif /* RING_BUFFER_H */
