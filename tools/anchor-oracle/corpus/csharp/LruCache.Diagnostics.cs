#nullable enable

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using Caching.Diagnostics;

namespace Caching.Memory
{
    [DebuggerDisplay("Count = {Count}, Capacity = {Capacity}, HitRatio = {HitRatio,nq}")]
    public sealed partial class LruCache<TKey, TValue>
    {
        private long _hits;
        private long _misses;

        public long Hits => Interlocked.Read(ref _hits);

        public long Misses => Interlocked.Read(ref _misses);

        public string HitRatio => Hits + Misses == 0
            ? "n/a"
            : ((double)Hits / (Hits + Misses)).ToString("P1", CultureInfo.InvariantCulture);

        public CacheSnapshot<TKey> Snapshot(int top = 10)
        {
            KeyValuePair<TKey, DateTimeOffset>[] recent;
            lock (_sync)
            {
                recent = _order
                    .Take(top)
                    .Select(e => KeyValuePair.Create(e.Key, e.ExpiresAt))
                    .ToArray();
            }

            return new CacheSnapshot<TKey>(Hits, Misses, recent);
        }

#if DEBUG
        internal void AssertInvariants()
        {
            lock (_sync)
            {
                Debug.Assert(_map.Count == _order.Count, $"map/order drift: {_map.Count} != {_order.Count}");
                foreach (var entry in _order)
                {
                    Debug.Assert(_map.ContainsKey(entry.Key), $"orphan node for key {{{entry.Key}}}");
                }
            }
        }
#endif

        public string Dump()
        {
            var sb = new StringBuilder();
            sb.AppendLine($"LruCache<{typeof(TKey).Name}, {typeof(TValue).Name}> {{ capacity = {Capacity} }}");
            lock (_sync)
            {
                var rank = 0;
                foreach (var entry in _order)
                {
#if DEBUG
                    sb.Append(CultureInfo.InvariantCulture, $"  [{rank++,3}] {entry.Key} -> {entry.Value} (expires {entry.ExpiresAt:O})");
#else
                    sb.Append(CultureInfo.InvariantCulture, $"  [{rank++,3}] {entry.Key}");
#endif
                    sb.AppendLine();
                }
            }

            return sb.ToString();
        }
    }
}

namespace Caching.Diagnostics
{
    public sealed record CacheSnapshot<TKey>(
        long Hits,
        long Misses,
        IReadOnlyList<KeyValuePair<TKey, DateTimeOffset>> MostRecent)
    {
        public double HitRate => Hits + Misses == 0 ? 0d : (double)Hits / (Hits + Misses);

        public bool IsCold => this is { Hits: 0, Misses: > 0 };
    }

    public static class CacheSnapshotExtensions
    {
        public static string ToReport<TKey>(this CacheSnapshot<TKey> snapshot, DateTimeOffset now)
        {
            var expiring =
                from pair in snapshot.MostRecent
                let remaining = pair.Value - now
                where remaining < TimeSpan.FromMinutes(1)
                orderby remaining
                select $"{pair.Key} ({remaining.TotalSeconds:F0}s)";

            return string.Join(Environment.NewLine, expiring.Prepend($"hit rate {snapshot.HitRate:P1}"));
        }
    }
}
