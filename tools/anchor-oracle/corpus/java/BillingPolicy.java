package billing.policy;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class BillingPolicy {

    public enum Cycle {
        MONTHLY(12) {
            @Override
            LocalDate next(LocalDate from) {
                return from.plusMonths(1);
            }
        },
        QUARTERLY(4) {
            @Override
            LocalDate next(LocalDate from) {
                return from.plusMonths(3);
            }
        },
        ANNUAL(1) {
            @Override
            LocalDate next(LocalDate from) {
                return from.plusYears(1);
            }

            @Override
            boolean prorates() {
                return false;
            }
        };

        final int periodsPerYear;

        Cycle(int periodsPerYear) {
            this.periodsPerYear = periodsPerYear;
        }

        abstract LocalDate next(LocalDate from);

        boolean prorates() {
            return true;
        }
    }

    public enum TaxClass { STANDARD, REDUCED, EXEMPT }

    public record Money(BigDecimal amount, String currency) {
        public Money {
            Objects.requireNonNull(amount, "amount");
            if (currency == null || currency.length() != 3) {
                throw new IllegalArgumentException("currency must be an ISO-4217 code: " + currency);
            }
            amount = amount.setScale(2, RoundingMode.HALF_EVEN);
        }

        public Money plus(Money other) {
            requireSameCurrency(other);
            return new Money(amount.add(other.amount), currency);
        }

        public Money times(BigDecimal factor) {
            return new Money(amount.multiply(factor), currency);
        }

        private void requireSameCurrency(Money other) {
            if (!currency.equals(other.currency)) {
                throw new IllegalArgumentException(currency + " vs " + other.currency);
            }
        }
    }

    public sealed interface Adjustment permits Discount, Surcharge, Credit {
        Money apply(Money subtotal);
    }

    public record Discount(BigDecimal percent, String code) implements Adjustment {
        @Override
        public Money apply(Money subtotal) {
            return subtotal.times(BigDecimal.ONE.subtract(percent.movePointLeft(2)));
        }
    }

    public record Surcharge(Money flat, String reason) implements Adjustment {
        @Override
        public Money apply(Money subtotal) {
            return subtotal.plus(flat);
        }
    }

    public record Credit(Money amount) implements Adjustment {
        @Override
        public Money apply(Money subtotal) {
            Money result = subtotal.plus(new Money(amount.amount().negate(), amount.currency()));
            return result.amount().signum() < 0 ? new Money(BigDecimal.ZERO, subtotal.currency()) : result;
        }
    }

    private final Map<TaxClass, BigDecimal> taxRates = new EnumMap<>(TaxClass.class);
    private final int graceDays;

    public BillingPolicy(BigDecimal standardRate, BigDecimal reducedRate, int graceDays) {
        taxRates.put(TaxClass.STANDARD, standardRate);
        taxRates.put(TaxClass.REDUCED, reducedRate);
        this.graceDays = graceDays;
    }

    public BigDecimal taxRate(TaxClass taxClass) {
        return switch (taxClass) {
            case STANDARD, REDUCED -> taxRates.get(taxClass);
            case EXEMPT -> BigDecimal.ZERO;
        };
    }

    public LocalDate dueDate(LocalDate issued) {
        LocalDate due = issued.plusDays(graceDays);
        int shift = switch (due.getDayOfWeek()) {
            case SATURDAY -> 2;
            case SUNDAY -> 1;
            default -> {
                if (due.getMonthValue() == 12 && due.getDayOfMonth() == 25) {
                    yield 1;
                }
                yield 0;
            }
        };
        return due.plusDays(shift);
    }

    public Money total(List<Money> lines, List<? extends Adjustment> adjustments, TaxClass taxClass) {
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("invoice has no lines");
        }
        Money subtotal = lines.get(0);
        for (int i = 1; i < lines.size(); i++) {
            subtotal = subtotal.plus(lines.get(i));
        }
        // Surcharges first, then percentage discounts, then fixed credits: a credit
        // must never be scaled by a discount.
        List<Adjustment> ordered = new ArrayList<>(adjustments);
        ordered.sort((a, b) -> Integer.compare(rank(a), rank(b)));
        for (Adjustment adj : ordered) {
            subtotal = adj.apply(subtotal);
        }
        return subtotal.times(BigDecimal.ONE.add(taxRate(taxClass)));
    }

    private static int rank(Adjustment a) {
        if (a instanceof Surcharge) {
            return 0;
        }
        return a instanceof Discount d && d.percent().signum() > 0 ? 1 : 2;
    }

    static String dunningLevel(int daysOverdue) {
        return switch (daysOverdue / 15) {
            case 0:
                yield "reminder";
            case 1:
            case 2:
                yield "warning";
            default:
                String level = daysOverdue > 90 ? "collections" : "final-notice";
                yield level;
        };
    }
}
