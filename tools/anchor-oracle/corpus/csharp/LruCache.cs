#nullable enable

using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Threading;
using System.Threading.Tasks;

namespace Caching.Memory
{
    public enum EvictionReason { Capacity, Expired, Removed, Replaced }

    public delegate void EvictionHandler<in TKey, in TValue>(TKey key, TValue value, EvictionReason reason);

    public interface ICache<TKey, TValue>
        where TKey : notnull
    {
        int Count { get; }

        bool TryGet(TKey key, [MaybeNullWhen(false)] out TValue value);

        void Set(TKey key, TValue value, TimeSpan? ttl = null);

        TValue GetOrAdd(TKey key, Func<TKey, TValue> factory)
        {
            if (TryGet(key, out var existing))
            {
                return existing;
            }

            var created = factory(key);
            Set(key, created);
            return created;
        }
    }

    /// <summary>Bounded LRU cache with per-entry expiry; see <see cref="Evicted"/> for disposal.</summary>
    public sealed partial class LruCache<TKey, TValue> : ICache<TKey, TValue>, IDisposable
        where TKey : notnull
        where TValue : class
    {
        private readonly Dictionary<TKey, LinkedListNode<Entry>> _map;
        private readonly LinkedList<Entry> _order = new();
        private readonly SemaphoreSlim _loadGate = new(1, 1);
        private readonly object _sync = new();
        private readonly Func<DateTimeOffset> _clock;
        private EvictionHandler<TKey, TValue>? _evicted;
        private int _capacity;
        private bool _disposed;

        public LruCache(int capacity, IEqualityComparer<TKey>? comparer = null, Func<DateTimeOffset>? clock = null)
        {
            _map = new Dictionary<TKey, LinkedListNode<Entry>>(Math.Max(capacity, 0), comparer);
            _clock = clock ?? (() => DateTimeOffset.UtcNow);
            Capacity = capacity;
        }

        public event EvictionHandler<TKey, TValue>? Evicted
        {
            add { lock (_sync) { _evicted += value; } }
            remove { lock (_sync) { _evicted -= value; } }
        }

        public event EventHandler? Cleared;

        #region Properties

        public int Capacity
        {
            get => _capacity;
            set
            {
                if (value <= 0)
                {
                    throw new ArgumentOutOfRangeException(nameof(value), value, "Capacity must be positive.");
                }

                lock (_sync)
                {
                    _capacity = value;
                    TrimToCapacity();
                }
            }
        }

        public int Count => _map.Count;

        public TimeSpan DefaultTtl { get; init; } = TimeSpan.FromMinutes(5);

        #endregion

        public TValue this[TKey key]
        {
            get => TryGet(key, out var hit) ? hit : throw new KeyNotFoundException($"Key '{key}' is not cached.");
            set => Set(key, value);
        }

        public bool TryGet(TKey key, [MaybeNullWhen(false)] out TValue value)
        {
            lock (_sync)
            {
                if (_map.TryGetValue(key, out var node))
                {
                    if (node.Value.ExpiresAt > _clock())
                    {
                        _order.Remove(node);
                        _order.AddFirst(node);
                        Interlocked.Increment(ref _hits);
                        value = node.Value.Value;
                        return true;
                    }

                    RemoveNode(node, EvictionReason.Expired);
                }
            }

            Interlocked.Increment(ref _misses);
            value = default;
            return false;
        }

        public void Set(TKey key, TValue value, TimeSpan? ttl = null)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var entry = new Entry(key, value, _clock() + (ttl ?? DefaultTtl));
            lock (_sync)
            {
                if (_map.TryGetValue(key, out var existing))
                {
                    RemoveNode(existing, EvictionReason.Replaced);
                }

                _map[key] = _order.AddFirst(entry);
                TrimToCapacity();
            }
        }

        public async Task<TValue> GetOrAddAsync(
            TKey key,
            Func<TKey, CancellationToken, Task<TValue>> factory,
            CancellationToken cancellationToken = default)
        {
            if (TryGet(key, out var cached))
            {
                return cached;
            }

            await _loadGate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                // Another caller may have loaded the entry while this one waited.
                if (TryGet(key, out cached))
                {
                    return cached;
                }

                var loaded = await factory(key, cancellationToken).ConfigureAwait(false);
                Set(key, loaded);
                return loaded;
            }
            finally
            {
                _loadGate.Release();
            }
        }

        public void Clear()
        {
            lock (_sync)
            {
                _map.Clear();
                _order.Clear();
            }

            Cleared?.Invoke(this, EventArgs.Empty);
        }

        public void Dispose()
        {
            if (_disposed)
            {
                return;
            }

            Clear();
            _disposed = true;
            _loadGate.Dispose();
        }

        private void TrimToCapacity()
        {
            while (_map.Count > _capacity && _order.Last is { } oldest)
            {
                RemoveNode(oldest, EvictionReason.Capacity);
            }
        }

        private void RemoveNode(LinkedListNode<Entry> node, EvictionReason reason)
        {
            _order.Remove(node);
            _map.Remove(node.Value.Key);
            _evicted?.Invoke(node.Value.Key, node.Value.Value, reason);
        }

        private sealed record Entry(TKey Key, TValue Value, DateTimeOffset ExpiresAt);
    }
}
