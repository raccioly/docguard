using System;

namespace Sample
{
    public static class Pricing
    {
        // @implements acme.golden#FR-001
        public static double Total(int[] items, double rate)
        {
            var sum = 0;
            foreach (var item in items)
            {
                sum += item;
            }
            return sum * (1 - rate);
        }
    }

    public class Cart
    {
        // @implements acme.golden#FR-002
        public void Add(int item)
        {
            Console.WriteLine($"item {item}");
        }
    }
}
