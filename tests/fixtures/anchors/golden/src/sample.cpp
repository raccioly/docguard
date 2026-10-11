#include <iostream>
#include <vector>

// @implements acme.golden#FR-001
double total(const std::vector<int>& items, double rate) {
    int sum = 0;
    for (int item : items) {
        sum += item;
    }
    return sum * (1 - rate);
}

class Cart {
public:
    // @implements acme.golden#FR-002
    void add(int item) {
        std::cout << "item " << item << std::endl;
    }
};
