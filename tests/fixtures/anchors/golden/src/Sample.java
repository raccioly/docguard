package acme;

import java.util.List;

public class Sample {
    // @implements acme.golden#FR-001
    public double total(List<Integer> items, double rate) {
        int sum = 0;
        for (int item : items) { sum += item; }
        return sum * (1 - rate);
    }

    // @implements acme.golden#FR-002
    public void add(int item) { System.out.println(item); }
}
