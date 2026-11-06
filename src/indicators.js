/**
 * Indicator calculations used by BharatChart.
 * Input bars must be chronological and contain { time, open, high, low, close }.
 */

function validPeriod(period, name = "period") {
  const value = Number(period);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new RangeError(`${name} must be an integer between 1 and 1000.`);
  }
  return value;
}

/** Average Daily Range in price units: SMA(high) - SMA(low), using daily bars. */
export function calculateADR(bars, period = 14) {
  const length = validPeriod(period, "ADR period");
  const output = [];
  let highSum = 0;
  let lowSum = 0;

  for (let i = 0; i < bars.length; i += 1) {
    highSum += Number(bars[i].high);
    lowSum += Number(bars[i].low);
    if (i >= length) {
      highSum -= Number(bars[i - length].high);
      lowSum -= Number(bars[i - length].low);
    }
    if (i >= length - 1) {
      output.push({ time: bars[i].time, value: (highSum - lowSum) / length });
    }
  }
  return output;
}

/** Wilder's Relative Strength Index using Wilder's smoothed averages. */
export function calculateRSI(bars, period = 14) {
  const length = validPeriod(period, "RSI period");
  if (bars.length <= length) return [];

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= length; i += 1) {
    const change = Number(bars[i].close) - Number(bars[i - 1].close);
    gainSum += Math.max(change, 0);
    lossSum += Math.max(-change, 0);
  }

  let averageGain = gainSum / length;
  let averageLoss = lossSum / length;
  const rsiValue = () => {
    if (averageLoss === 0 && averageGain === 0) return 50;
    if (averageLoss === 0) return 100;
    const relativeStrength = averageGain / averageLoss;
    return 100 - (100 / (1 + relativeStrength));
  };

  const output = [{ time: bars[length].time, value: rsiValue() }];
  for (let i = length + 1; i < bars.length; i += 1) {
    const change = Number(bars[i].close) - Number(bars[i - 1].close);
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    averageGain = ((averageGain * (length - 1)) + gain) / length;
    averageLoss = ((averageLoss * (length - 1)) + loss) / length;
    output.push({ time: bars[i].time, value: rsiValue() });
  }
  return output;
}

/**
 * Wilder's Accumulative Swing Index. T is the user-supplied limit-move value
 * in the instrument's quoted price units (rupees for Indian equities).
 */
export function calculateASI(bars, limitMove = 12) {
  const limit = Number(limitMove);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError("ASI limit move T must be a positive number.");
  }
  if (bars.length === 0) return [];

  const output = [{ time: bars[0].time, value: 0 }];
  let accumulated = 0;

  for (let i = 1; i < bars.length; i += 1) {
    const current = bars[i];
    const previous = bars[i - 1];
    const previousClose = Number(previous.close);
    const a = Math.abs(Number(current.high) - previousClose);
    const b = Math.abs(Number(current.low) - previousClose);
    const dayRange = Math.abs(Number(current.high) - Number(current.low));
    const priorBody = Math.abs(previousClose - Number(previous.open));
    const k = Math.max(a, b);
    const largestRange = Math.max(dayRange, k);

    let r = largestRange + (priorBody / 4);
    if (largestRange === a) r -= b / 2;
    else if (largestRange === b) r -= a / 2;

    const numerator = (Number(current.close) - previousClose)
      + (0.5 * (Number(current.close) - Number(current.open)))
      + (0.25 * (previousClose - Number(previous.open)));
    const swingIndex = r === 0 ? 0 : 50 * (numerator / r) * (k / limit);
    accumulated += swingIndex;
    output.push({ time: current.time, value: accumulated });
  }

  return output;
}
