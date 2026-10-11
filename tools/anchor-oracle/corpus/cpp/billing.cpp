#include "billing.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <initializer_list>
#include <stdexcept>
#include <utility>

namespace billing {
namespace {

template <class... Ts>
struct overloaded : Ts... {
    using Ts::operator()...;
};

template <class... Ts>
overloaded(Ts...) -> overloaded<Ts...>;

// Placeholders are ${name}; every other character, braces included, is literal.
constexpr std::string_view kInvoiceTemplate = R"({
  "customer": "${customer}",
  "currency": "${currency}",
  "lines": [${lines}],
  "total": ${total},
  "note": "${note}"
})";

constexpr std::string_view kFeeLine = R"line({"type":"fee","label":"${label}","amount":${amount}})line";
constexpr std::string_view kUsageLine =
    R"line({"type":"usage","meter":"${label}","units":${units},"amount":${amount}})line";
constexpr std::string_view kDiscountLine = R"line({"type":"discount","code":"${label}","pct":${pct}})line";

// The delimiter is required: the text itself contains )" after "invoice id".
constexpr std::string_view kDisputeNote =
    R"note(Questions? Reply with "ref (invoice id)" in the subject line.)note";

static_assert(1.50_usd == Money(150, Currency::USD));
static_assert(2_usd != 1.99_usd);

std::string substitute(std::string_view tmpl,
                       std::initializer_list<std::pair<std::string_view, std::string>> vars)
{
    std::string out;
    out.reserve(tmpl.size() + 64);
    std::size_t pos = 0;
    while (pos < tmpl.size()) {
        const auto open = tmpl.find("${", pos);
        if (open == std::string_view::npos) {
            out.append(tmpl.substr(pos));
            break;
        }
        const auto close = tmpl.find('}', open + 2);
        if (close == std::string_view::npos) {
            throw std::invalid_argument("unterminated \"${\" in template");
        }
        const auto name = tmpl.substr(open + 2, close - open - 2);
        const auto match = std::find_if(vars.begin(), vars.end(),
                                        [name](const auto &var) { return var.first == name; });
        if (match == vars.end()) {
            throw std::out_of_range("no value for ${" + std::string(name) + "}");
        }
        out.append(tmpl.substr(pos, open - pos)).append(match->second);
        pos = close + 1;
    }
    return out;
}

std::string escape_json(std::string_view text)
{
    std::string out;
    out.reserve(text.size());
    for (const char ch : text) {
        switch (ch) {
        case '"':
            out += "\\\"";
            break;
        case '\\':
            out += "\\\\";
            break;
        default:
            out += ch;
        }
    }
    return out;
}

std::string format_amount(const Money &money)
{
    const auto value = money.minor_units();
    if (money.currency() == Currency::JPY) {
        return std::to_string(value);
    }
    const auto magnitude = static_cast<unsigned long long>(value < 0 ? -value : value);
    char buf[32];
    std::snprintf(buf, sizeof buf, "%s%llu.%02llu", value < 0 ? "-" : "", magnitude / 100,
                  magnitude % 100);
    return buf;
}

void require_same(Currency expected, Currency actual)
{
    if (expected != actual) {
        throw std::invalid_argument("currency mismatch: expected " +
                                    std::string(currency_code(expected)) + ", got " +
                                    std::string(currency_code(actual)));
    }
}

template <typename Item>
std::string render_line(const Item &item);

template <>
std::string render_line<FlatFee>(const FlatFee &fee)
{
    return substitute(kFeeLine, {{"label", escape_json(fee.description)},
                                 {"amount", format_amount(fee.amount)}});
}

template <>
std::string render_line<MeteredUsage>(const MeteredUsage &usage)
{
    return substitute(kUsageLine, {{"label", escape_json(usage.meter)},
                                   {"units", std::to_string(usage.units)},
                                   {"amount", format_amount(usage.cost())}});
}

template <>
std::string render_line<Discount>(const Discount &discount)
{
    return substitute(kDiscountLine, {{"label", escape_json(discount.code)},
                                      {"pct", std::to_string(discount.percent)}});
}

} // namespace

std::string_view currency_code(Currency currency) noexcept
{
    switch (currency) {
    case Currency::USD: return "USD";
    case Currency::EUR: return "EUR";
    case Currency::GBP: return "GBP";
    case Currency::JPY: return "JPY";
    }
    return "XXX";
}

Money &Money::operator+=(const Money &other)
{
    require_same(currency_, other.currency_);
    minor_units_ += other.minor_units_;
    return *this;
}

Money &Money::operator-=(const Money &other)
{
    require_same(currency_, other.currency_);
    minor_units_ -= other.minor_units_;
    return *this;
}

Money Money::scaled(double factor) const
{
    const auto rounded = std::llround(static_cast<double>(minor_units_) * factor);
    return Money(static_cast<std::int64_t>(rounded), currency_);
}

Invoice::Invoice(std::string customer_ref, Currency currency)
    : customer_ref_(std::move(customer_ref)),
      currency_(currency)
{
    if (customer_ref_.empty()) {
        throw std::invalid_argument("customer reference must not be empty");
    }
}

void Invoice::add(LineItem item)
{
    std::visit(overloaded{
                   [this](const FlatFee &fee) { require_same(currency_, fee.amount.currency()); },
                   [this](const MeteredUsage &use) { require_same(currency_, use.unit_price.currency()); },
                   [](const Discount &discount) {
                       if (!(discount.percent > 0.0 && discount.percent <= 100.0)) {
                           throw std::domain_error("discount out of range: " + discount.code);
                       }
                   },
               },
               item);
    items_.push_back(std::move(item));
}

Money Invoice::subtotal() const
{
    Money sum(0, currency_);
    for (const auto &item : items_) {
        sum += std::visit(overloaded{
                              [](const FlatFee &fee) { return fee.amount; },
                              [](const MeteredUsage &usage) { return usage.cost(); },
                              [this](const Discount &) { return Money(0, currency_); },
                          },
                          item);
    }
    return sum;
}

Money Invoice::discount_total() const
{
    const Money base = subtotal();
    Money discounts(0, currency_);
    for (const auto &item : items_) {
        if (const auto *discount = std::get_if<Discount>(&item)) {
            discounts += base.scaled(discount->percent / 100.0);
        }
    }
    return discounts.minor_units() > base.minor_units() ? base : discounts;
}

std::string Invoice::to_json() const
{
    std::string lines;
    for (const auto &item : items_) {
        if (!lines.empty()) {
            lines += ',';
        }
        lines += std::visit([](const auto &line) { return render_line(line); }, item);
    }
    return substitute(kInvoiceTemplate, {{"customer", escape_json(customer_ref_)},
                                         {"currency", std::string(currency_code(currency_))},
                                         {"lines", lines},
                                         {"total", format_amount(total())},
                                         {"note", escape_json(kDisputeNote)}});
}

} // namespace billing
