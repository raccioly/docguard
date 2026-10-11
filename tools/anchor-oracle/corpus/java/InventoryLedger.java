package inventory.ledger;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * Append-only ledger of stock movements per warehouse bin. Quantities are kept
 * in the smallest sellable unit; a negative delta is a pick.
 */
public class InventoryLedger implements Iterable<InventoryLedger.Movement> {

    private static final Map<String, Integer> UNIT_FACTORS = new HashMap<>();
    private static final char SEPARATOR = '|';

    static {
        UNIT_FACTORS.put("ea", 1);
        UNIT_FACTORS.put("pk", 6);
        UNIT_FACTORS.put("cs", 24);
        UNIT_FACTORS.put("pl", 24 * 40);
    }

    private final Map<String, Bin> bins = new ConcurrentHashMap<>();
    private final List<Movement> journal = new ArrayList<>();
    private final AtomicLong sequence = new AtomicLong();

    public record Movement(long seq, String binCode, String sku, int delta, Instant at) {
        public Movement {
            Objects.requireNonNull(binCode, "binCode");
            Objects.requireNonNull(sku, "sku");
            if (delta == 0) {
                throw new IllegalArgumentException("zero-quantity movement for " + sku);
            }
        }

        boolean isPick() {
            return delta < 0;
        }
    }

    /** A storage location; inner so that it appends to the owning ledger's journal. */
    public final class Bin {
        private final String code;
        private final boolean allowBackorder;
        private final Map<String, Integer> onHand = new HashMap<>();

        private Bin(String code, boolean allowBackorder) {
            this.code = code;
            this.allowBackorder = allowBackorder;
        }

        public Movement apply(String sku, int delta) {
            synchronized (InventoryLedger.this) {
                int current = onHand.getOrDefault(sku, 0);
                if (current + delta < 0 && !allowBackorder) {
                    throw new IllegalStateException(String.format(
                            "bin %s: requested %d of %s, %d on hand", code, -delta, sku, current));
                }
                onHand.merge(sku, delta, Integer::sum);
                Movement m = new Movement(sequence.incrementAndGet(), code, sku, delta, Instant.now());
                journal.add(m);
                return m;
            }
        }
    }

    public Bin openBin(String code, boolean allowBackorder) {
        return bins.computeIfAbsent(code, c -> new Bin(c, allowBackorder));
    }

    public static <K extends Comparable<? super K>, V> Map<K, List<V>> groupSorted(
            Collection<? extends V> items,
            Function<? super V, ? extends K> keyFn) {
        Map<K, List<V>> grouped = new TreeMap<>();
        for (V item : items) {
            grouped.computeIfAbsent(keyFn.apply(item), k -> new ArrayList<>()).add(item);
        }
        return grouped;
    }

    /**
     * Imports a pipe-delimited export such as {@code A-01-03|SKU-1182|cs|-2}.
     * Fields containing the separator are quoted: {@code "A|B"|SKU-9|ea|4}.
     */
    @SuppressWarnings({"resource", "unused"})
    public int importMovements(Path source, boolean strict)
            throws IOException,
                   IllegalStateException {
        int applied = 0;
        try (BufferedReader reader = Files.newBufferedReader(source, StandardCharsets.UTF_8)) {
            String line;
            int lineNo = 0;
            while ((line = reader.readLine()) != null) {
                lineNo++;
                if (line.isBlank() || line.charAt(0) == '#') {
                    continue;
                }
                List<String> f = splitFields(line);
                Integer factor = UNIT_FACTORS.get(f.size() == 4 ? f.get(2) : "");
                if (factor == null) {
                    if (strict) {
                        throw new IOException("line " + lineNo + ": cannot parse \"" + line + "\"");
                    }
                    continue;
                }
                openBin(f.get(0), false).apply(f.get(1), Integer.parseInt(f.get(3)) * factor);
                applied++;
            }
        }
        return applied;
    }

    static List<String> splitFields(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (quoted && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    cur.append('"');
                    i++;
                } else {
                    quoted = !quoted;
                }
            } else if (c == SEPARATOR && !quoted) {
                out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        out.add(cur.toString());
        return out;
    }

    @Override
    public Iterator<Movement> iterator() {
        synchronized (this) {
            return List.copyOf(journal).iterator();
        }
    }

    @Deprecated(since = "3.2", forRemoval = true)
    public List<Movement> picksSince(Instant cutoff) {
        List<Movement> result = new ArrayList<>();
        forEach(m -> {
            if (m.isPick() && !m.at().isBefore(cutoff)) {
                result.add(m);
            }
        });
        result.sort(Comparator.comparing(Movement::at).thenComparingLong(Movement::seq));
        return result;
    }
}
