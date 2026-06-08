/**
 * Find pivot lows/highs in a candle array.
 * A pivot low: low[i] < low[i-1] && low[i] < low[i+1]
 * A pivot high: high[i] > high[i-1] && high[i] > high[i+1]
 */

const TOLERANCE = 0.005; // 0.5% price band for level clustering

function cluster(levels) {
  const sorted = [...levels].sort((a, b) => a - b);
  const clusters = [];
  for (const price of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(price - last.price) / last.price < TOLERANCE) {
      last.count++;
      last.price = (last.price * (last.count - 1) + price) / last.count;
    } else {
      clusters.push({ price, count: 1 });
    }
  }
  return clusters;
}

export function findSupports(candles, lookback = 50) {
  const slice = candles.slice(-lookback);
  const pivots = [];
  for (let i = 1; i < slice.length - 1; i++) {
    if (slice[i].low < slice[i - 1].low && slice[i].low < slice[i + 1].low) {
      pivots.push(slice[i].low);
    }
  }
  return cluster(pivots).filter(s => s.count >= 2);
}

export function findResistances(candles, lookback = 50) {
  const slice = candles.slice(-lookback);
  const pivots = [];
  for (let i = 1; i < slice.length - 1; i++) {
    if (slice[i].high > slice[i - 1].high && slice[i].high > slice[i + 1].high) {
      pivots.push(slice[i].high);
    }
  }
  return cluster(pivots).filter(r => r.count >= 2);
}

export function nearestSupport(candles, currentPrice, lookback = 50) {
  const supports = findSupports(candles, lookback);
  const below = supports.filter(s => s.price <= currentPrice * 1.02);
  if (!below.length) return null;
  below.sort((a, b) => b.price - a.price);
  return below[0];
}

export function nearestResistance(candles, currentPrice, lookback = 50) {
  const resistances = findResistances(candles, lookback);
  const above = resistances.filter(r => r.price > currentPrice);
  if (!above.length) return null;
  above.sort((a, b) => a.price - b.price);
  return above[0];
}

export function supportScore(support) {
  if (!support) return 0;
  return support.count;
}

export function resistanceScore(resistance) {
  if (!resistance) return 0;
  return resistance.count;
}
