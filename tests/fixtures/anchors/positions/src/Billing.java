package acme;

import java.util.List;

public class Billing {
    // @implements acme.billing#FR-002
    @Override
    public int total(int x) { return x; }

    // @implements acme.billing#FR-003
    public int total(String x) { return 0; }

    private final String s = "// @implements acme.billing#FR-009";
}
