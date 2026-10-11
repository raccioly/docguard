#include <stdio.h>

/* @implements acme.golden#FR-001 */
double total(const int *items, int count, double rate) {
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += items[i];
    }
    return sum * (1 - rate);
}

/* @implements acme.golden#FR-002 */
void add(int item) {
    printf("item %d\n", item);
}
