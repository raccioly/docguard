// Thread-safe LRU cache bounded by key "weight" rather than entry count, so a
// cache of strings can be sized roughly by memory.
#pragma once

#include <cstddef>
#include <functional>
#include <list>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace storage::cache {
inline namespace v2 {

enum class EvictionReason : unsigned char { Capacity, Explicit };

struct CacheStats {
    std::size_t hits = 0;
    std::size_t misses = 0;
    std::size_t evictions = 0;

    [[nodiscard]] double hit_ratio() const noexcept
    {
        const auto lookups = hits + misses;
        return lookups == 0 ? 0.0 : static_cast<double>(hits) / static_cast<double>(lookups);
    }
};

template <typename Key>
struct KeyTraits {
    static std::size_t hash(const Key &key) { return std::hash<Key>{}(key); }
    static constexpr std::size_t weight(const Key &) noexcept { return 1; }
};

template <typename T>
struct KeyTraits<T *> {
    static std::size_t hash(T *key) noexcept { return std::hash<const void *>{}(key); }
    static constexpr std::size_t weight(T *) noexcept { return 1; }
};

template <>
struct KeyTraits<std::string> {
    static std::size_t hash(const std::string &key) noexcept
    {
        return std::hash<std::string_view>{}(key);
    }

    // Long keys cost more so a few pathological URLs cannot flood the cache.
    static std::size_t weight(const std::string &key) noexcept { return 1 + key.size() / 64; }
};

template <typename Key, typename Value, typename Traits = KeyTraits<Key>>
class LruCache {
public:
    using EvictionCallback = std::function<void(const Key &, const Value &, EvictionReason)>;

    explicit LruCache(std::size_t capacity, EvictionCallback on_evict = {})
        : capacity_(capacity),
          on_evict_(std::move(on_evict))
    {
        index_.reserve(capacity);
    }

    LruCache(const LruCache &) = delete;
    LruCache &operator=(const LruCache &) = delete;
    ~LruCache() = default;

    [[nodiscard]] std::optional<Value> get(const Key &key);
    void put(const Key &key, Value value);
    bool erase(const Key &key);

    [[nodiscard]] CacheStats stats() const
    {
        std::lock_guard<std::mutex> lock(mutex_);
        return stats_;
    }

private:
    using EntryList = std::list<std::pair<Key, Value>>;

    struct Hasher {
        std::size_t operator()(const Key &key) const { return Traits::hash(key); }
    };

    void evict_back(EvictionReason reason);

    std::size_t capacity_;
    std::size_t weight_ = 0;
    EvictionCallback on_evict_;
    EntryList entries_;
    std::unordered_map<Key, typename EntryList::iterator, Hasher> index_;
    CacheStats stats_;
    mutable std::mutex mutex_;
};

template <typename Key, typename Value, typename Traits>
std::optional<Value> LruCache<Key, Value, Traits>::get(const Key &key)
{
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = index_.find(key);
    if (it == index_.end()) {
        ++stats_.misses;
        return std::nullopt;
    }
    entries_.splice(entries_.begin(), entries_, it->second);
    ++stats_.hits;
    return it->second->second;
}

template <typename Key, typename Value, typename Traits>
void LruCache<Key, Value, Traits>::put(const Key &key, Value value)
{
    std::lock_guard<std::mutex> lock(mutex_);
    if (auto it = index_.find(key); it != index_.end()) {
        it->second->second = std::move(value);
        entries_.splice(entries_.begin(), entries_, it->second);
        return;
    }
    weight_ += Traits::weight(key);
    while (weight_ > capacity_ && !entries_.empty()) {
        evict_back(EvictionReason::Capacity);
    }
    entries_.emplace_front(key, std::move(value));
    index_.emplace(key, entries_.begin());
}

template <typename Key, typename Value, typename Traits>
bool LruCache<Key, Value, Traits>::erase(const Key &key)
{
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = index_.find(key);
    if (it == index_.end()) {
        return false;
    }
    entries_.splice(entries_.end(), entries_, it->second);
    evict_back(EvictionReason::Explicit);
    return true;
}

template <typename Key, typename Value, typename Traits>
void LruCache<Key, Value, Traits>::evict_back(EvictionReason reason)
{
    auto &victim = entries_.back();
    weight_ -= Traits::weight(victim.first);
    if (reason == EvictionReason::Capacity) {
        ++stats_.evictions;
    }
    if (on_evict_) {
        on_evict_(victim.first, victim.second, reason);
    }
    index_.erase(victim.first);
    entries_.pop_back();
}

template <typename Value>
using StringCache = LruCache<std::string, Value>;

} // namespace v2
} // namespace storage::cache
