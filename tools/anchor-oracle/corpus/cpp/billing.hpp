#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace billing {

enum class Currency : std::uint8_t { USD, EUR, GBP, JPY };

[[nodiscard]] std::string_view currency_code(Currency currency) noexcept;

class Money {
public:
    constexpr Money() noexcept = default;
    constexpr Money(std::int64_t minor_units, Currency currency) noexcept
        : minor_units_(minor_units), currency_(currency)
    {
    }

    [[nodiscard]] constexpr std::int64_t minor_units() const noexcept { return minor_units_; }
    [[nodiscard]] constexpr Currency currency() const noexcept { return currency_; }

    Money &operator+=(const Money &other);
    Money &operator-=(const Money &other);
    [[nodiscard]] Money scaled(double factor) const;

    friend Money operator+(Money lhs, const Money &rhs) { return lhs += rhs; }
    friend Money operator-(Money lhs, const Money &rhs) { return lhs -= rhs; }

    friend constexpr bool operator==(const Money &a, const Money &b) noexcept
    {
        return a.minor_units_ == b.minor_units_ && a.currency_ == b.currency_;
    }

    friend constexpr bool operator!=(const Money &a, const Money &b) noexcept { return !(a == b); }

private:
    std::int64_t minor_units_ = 0;
    Currency currency_ = Currency::USD;
};

inline namespace literals {

constexpr Money operator""_usd(long double amount) noexcept
{
    return Money(static_cast<std::int64_t>(amount * 100.0L + 0.5L), Currency::USD);
}

constexpr Money operator""_usd(unsigned long long whole) noexcept
{
    return Money(static_cast<std::int64_t>(whole) * 100, Currency::USD);
}

} // namespace literals

struct FlatFee {
    std::string description;
    Money amount;
};

struct MeteredUsage {
    std::string meter;
    std::uint64_t units = 0;
    Money unit_price;

    [[nodiscard]] Money cost() const
    {
        return Money(unit_price.minor_units() * static_cast<std::int64_t>(units),
                     unit_price.currency());
    }
};

struct Discount {
    std::string code;
    double percent = 0.0;
};

using LineItem = std::variant<FlatFee, MeteredUsage, Discount>;

class Invoice final {
public:
    Invoice(std::string customer_ref, Currency currency);

    void add(LineItem item);

    [[nodiscard]] Money subtotal() const;
    [[nodiscard]] Money discount_total() const;
    [[nodiscard]] Money total() const { return subtotal() - discount_total(); }
    [[nodiscard]] std::string to_json() const;

private:
    std::string customer_ref_;
    Currency currency_;
    std::vector<LineItem> items_;
};

} // namespace billing
