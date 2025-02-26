import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';

const fetchStockData = async (symbol) => {
  try {
    // 한국 주식인 경우 숫자만 있으면 .KS 추가
    const formattedSymbol = /^\d+$/.test(symbol) ? `${symbol}.KS` : symbol;
    
    // 백엔드 프록시 서버를 통해 요청 - URL 경로 수정
    const response = await fetch(
      `https://visualp.p-e.kr/api/stock-price/chart?ticker=${formattedSymbol}`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.chart?.error) {
      throw new Error(data.chart.error.description);
    }

    const quotes = data.chart.result[0];
    const timestamps = quotes.timestamp;
    const ohlc = quotes.indicators.quote[0];
    
    // 유효한 데이터만 필터링
    const cleanData = timestamps.map((timestamp, index) => ({
      date: new Date(timestamp * 1000),
      open: ohlc.open[index],
      high: ohlc.high[index],
      low: ohlc.low[index],
      close: ohlc.close[index],
      volume: ohlc.volume[index]
    })).filter(item => (
      // 모든 OHLC 데이터가 존재하는 경우만 포함
      item.open != null && 
      item.high != null && 
      item.low != null && 
      item.close != null &&
      item.volume != null
    ));

    return {
      dates: cleanData.map(item => item.date),
      open: cleanData.map(item => item.open),
      high: cleanData.map(item => item.high),
      low: cleanData.map(item => item.low),
      close: cleanData.map(item => item.close),
      volume: cleanData.map(item => item.volume)
    };
  } catch (error) {
    console.error('주식 데이터 로딩 실패:', error);
    throw new Error(`데이터를 가져올 수 없습니다: ${error.message}`);
  }
};

// MACD 계산 함수
const calculateMACD = (closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) => {
  const ema = (data, period) => {
    const k = 2 / (period + 1);
    let emaData = [data[0]];
    
    for (let i = 1; i < data.length; i++) {
      emaData[i] = data[i] * k + emaData[i-1] * (1-k);
    }
    return emaData;
  };

  const fastEMA = ema(closes, fastPeriod);
  const slowEMA = ema(closes, slowPeriod);
  const macdLine = fastEMA.map((fast, i) => fast - slowEMA[i]);
  const signalLine = ema(macdLine, signalPeriod);
  const histogram = macdLine.map((macd, i) => macd - signalLine[i]);

  return { macdLine, signalLine, histogram };
};

// RSI 계산 함수
const calculateRSI = (closes, period = 14) => {
  const changes = closes.slice(1).map((price, i) => price - closes[i]);
  const gains = changes.map(change => change > 0 ? change : 0);
  const losses = changes.map(change => change < 0 ? -change : 0);

  let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain) / period;
  let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss) / period;

  const rsi = [undefined];
  for (let i = 0; i < period; i++) {
    rsi.push(undefined);
  }

  for (let i = period; i < closes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
    
    const rs = avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }

  return rsi;
};

// Stochastic 계산 함수
const calculateStochastic = (highs, lows, closes, period = 14, smoothK = 3, smoothD = 3) => {
  const getLowest = (arr, start, period) => Math.min(...arr.slice(start - period + 1, start + 1));
  const getHighest = (arr, start, period) => Math.max(...arr.slice(start - period + 1, start + 1));

  const rawK = [];
  for (let i = 0; i < period - 1; i++) {
    rawK.push(undefined);
  }

  for (let i = period - 1; i < closes.length; i++) {
    const lowest = getLowest(lows, i, period);
    const highest = getHighest(highs, i, period);
    const close = closes[i];
    
    rawK.push(((close - lowest) / (highest - lowest)) * 100);
  }

  // K값 스무딩
  const k = [];
  for (let i = 0; i < smoothK - 1; i++) {
    k.push(undefined);
  }
  
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const sum = rawK.slice(i - smoothK + 1, i + 1).reduce((a, b) => a + (b || 0), 0);
    k.push(sum / smoothK);
  }

  // D값 계산 (K값의 이동평균)
  const d = [];
  for (let i = 0; i < smoothD - 1; i++) {
    d.push(undefined);
  }
  
  for (let i = smoothD - 1; i < k.length; i++) {
    const sum = k.slice(i - smoothD + 1, i + 1).reduce((a, b) => a + (b || 0), 0);
    d.push(sum / smoothD);
  }

  return { k, d };
};

// 이동평균선 계산 함수 추가
const calculateMA = (data, period) => {
  const ma = [];
  for (let i = 0; i < period - 1; i++) {
    ma.push(undefined);
  }
  
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    ma.push(sum / period);
  }
  return ma;
};

const StockChart = ({ stock, trades }) => {
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadChartData = async () => {
      try {
        setLoading(true);
        const data = await fetchStockData(stock.ticker);
        setChartData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadChartData();
  }, [stock.ticker]);

  if (loading) return <div className="text-center">차트 데이터를 불러오는 중...</div>;
  if (error) return <div className="text-center text-danger">데이터 로딩 실패: {error}</div>;
  if (!chartData) return null;

  // 보조지표 계산
  const macd = calculateMACD(chartData.close);
  const rsi = calculateRSI(chartData.close);
  const stoch = calculateStochastic(chartData.high, chartData.low, chartData.close);

  // 이동평균선 계산
  const ma5 = calculateMA(chartData.close, 5);
  const ma20 = calculateMA(chartData.close, 20);
  const ma60 = calculateMA(chartData.close, 60);
  const ma120 = calculateMA(chartData.close, 120);

  // 거래 표시용 annotations
  const annotations = trades?.reduce((acc, trade, index) => {
    // 날짜 문자열을 Date 객체로 변환
    const tradeDate = new Date(trade.date + 'T00:00:00');
    
    // 같은 날짜의 거래 찾기
    const sameDayTrades = trades.filter((t, i) => 
      t.date === trade.date && i <= index
    );
    const sameDayIndex = sameDayTrades.length - 1;
    
    const baseAY = trade.type === 'buy' ? -40 : 40;
    const offset = sameDayIndex * (trade.type === 'buy' ? -25 : 25);
    
    acc.push({
      x: tradeDate,  // Date 객체 사용
      y: parseFloat(trade.price),
      text: `${trade.type === 'buy' ? '매수' : '매도'} ${trade.quantity}주`,
      showarrow: true,
      arrowhead: 1,
      arrowsize: 1,
      arrowwidth: 1,
      arrowcolor: trade.type === 'buy' ? '#ff0000' : '#0000ff',
      ax: 0,
      ay: baseAY + offset, // 기본 위치에 offset 추가
      bgcolor: '#1F2937',
      bordercolor: '#374151',
      borderwidth: 1,
      borderpad: 1,
      font: { 
        size: 10, 
        color: '#F9FAFB'
      }
    });
    
    return acc;
  }, []) || [];

  // 거래 호버 데이터 수정
  const tradeHoverTrace = {
    type: 'scatter',
    x: trades?.map(trade => new Date(trade.date + 'T00:00:00')) || [],  // Date 객체로 변환
    y: trades?.map(trade => parseFloat(trade.price)) || [],
    mode: 'markers',
    marker: {
      size: 8,
      color: trades?.map(trade => trade.type === 'buy' ? '#ff0000' : '#0000ff') || [],
      symbol: trades?.map(trade => trade.type === 'buy' ? 'triangle-up' : 'triangle-down') || []
    },
    hovertemplate: trades?.map(trade => {
      const date = new Date(trade.date).toLocaleDateString();
      const type = trade.type === 'buy' ? '매수' : '매도';
      const price = parseFloat(trade.price).toLocaleString();
      const quantity = parseFloat(trade.quantity).toLocaleString();
      let text = `${date}<br>${type} ${quantity}주<br>@${price}원`;
      if (trade.memo) text += `<br>메모: ${trade.memo}`;
      return text + '<extra></extra>'; // 추가 레이블 제거
    }) || [],
    yaxis: 'y',
    showlegend: false
  };

  return (
    <Plot
      data={[
        // 캔들스틱 차트
        {
          type: 'candlestick',
          x: chartData.dates,
          open: chartData.open,
          high: chartData.high,
          low: chartData.low,
          close: chartData.close,
          increasing: { line: { color: '#26A69A' } },
          decreasing: { line: { color: '#EF5350' } },
          yaxis: 'y',
          name: '가격',
          connectgaps: false,  // 데이터가 없는 구간은 연결하지 않음
          xperiod: 24 * 60 * 60 * 1000,  // 1일 단위로 x축 설정
          xperiodalignment: 'start'  // 기간의 시작점 기준으로 정렬
        },
        // 이동평균선 추가
        {
          type: 'scatter',
          x: chartData.dates,
          y: ma5,
          name: 'MA5',
          line: { color: '#FFD700', width: 1 },
          yaxis: 'y'
        },
        {
          type: 'scatter',
          x: chartData.dates,
          y: ma20,
          name: 'MA20',
          line: { color: '#FF69B4', width: 1 },
          yaxis: 'y'
        },
        {
          type: 'scatter',
          x: chartData.dates,
          y: ma60,
          name: 'MA60',
          line: { color: '#4169E1', width: 1 },
          yaxis: 'y'
        },
        {
          type: 'scatter',
          x: chartData.dates,
          y: ma120,
          name: 'MA120',
          line: { color: '#32CD32', width: 1 },
          yaxis: 'y'
        },
        tradeHoverTrace,
        // MACD
        {
          type: 'scatter',
          x: chartData.dates,
          y: macd.macdLine,
          name: 'MACD',
          line: { color: '#2196F3' },
          yaxis: 'y2',
          showlegend: false
        },
        {
          type: 'scatter',
          x: chartData.dates,
          y: macd.signalLine,
          name: 'Signal',
          line: { color: '#FF9800' },
          yaxis: 'y2',
          showlegend: false
        },
        {
          type: 'bar',
          x: chartData.dates,
          y: macd.histogram,
          name: 'Histogram',
          marker: {
            color: macd.histogram.map(h => h >= 0 ? '#26A69A' : '#EF5350')
          },
          yaxis: 'y2',
          showlegend: false
        },
        // RSI
        {
          type: 'scatter',
          x: chartData.dates,
          y: rsi,
          name: 'RSI',
          line: { color: '#E91E63' },
          yaxis: 'y3',
          showlegend: false
        },
        // Stochastic
        {
          type: 'scatter',
          x: chartData.dates,
          y: stoch.k,
          name: '%K',
          line: { color: '#9C27B0' },
          yaxis: 'y4',
          showlegend: false
        },
        {
          type: 'scatter',
          x: chartData.dates,
          y: stoch.d,
          name: '%D',
          line: { color: '#FF5722' },
          yaxis: 'y4',
          showlegend: false
        }
      ]}
      layout={{
        title: {
          text: `${stock.companyName} (${stock.ticker})`,
          font: { color: '#F9FAFB', size: 18 }
        },
        paper_bgcolor: '#1F2937',
        plot_bgcolor: '#1F2937',
        dragmode: 'zoom',
        showlegend: true,
        legend: {
          font: { color: '#F9FAFB' },
          bgcolor: '#1F2937',
          bordercolor: '#374151',
          orientation: 'h',
          y: 1.12,
          x: 0.5,
          xanchor: 'center',
          traceorder: 'normal'
        },
        grid: {
          rows: 4,
          columns: 1,
          pattern: 'independent',
          roworder: 'top to bottom'
        },
        xaxis: {
          type: 'date',
          rangeslider: { visible: false },
          gridcolor: '#374151',
          linecolor: '#F9FAFB',
          tickcolor: '#F9FAFB',
          domain: [0, 1],
          rangebreaks: [{
            // 주말 제외
            pattern: 'day of week',
            bounds: [6, 1]  // 토요일(6)과 일요일(0) 제외
          }]
        },
        yaxis: {
          autorange: true,
          domain: [0.55, 1],
          gridcolor: '#374151',
          linecolor: '#F9FAFB',
          tickcolor: '#F9FAFB',
          title: { text: '가격', font: { color: '#F9FAFB' } },
          tickformat: ',.0f'
        },
        yaxis2: {
          domain: [0.35, 0.5],
          gridcolor: '#374151',
          linecolor: '#F9FAFB',
          tickcolor: '#F9FAFB',
          title: { text: 'MACD', font: { color: '#F9FAFB' } }
        },
        yaxis3: {
          domain: [0.2, 0.35],
          gridcolor: '#374151',
          linecolor: '#F9FAFB',
          tickcolor: '#F9FAFB',
          title: { text: 'RSI', font: { color: '#F9FAFB' } },
          range: [0, 100]
        },
        yaxis4: {
          domain: [0, 0.15],
          gridcolor: '#374151',
          linecolor: '#F9FAFB',
          tickcolor: '#F9FAFB',
          title: { text: 'Stochastic', font: { color: '#F9FAFB' } },
          range: [0, 100]
        },
        annotations: [
          ...annotations,
          // RSI 기준선
          {
            y: 70,
            xref: 'paper',
            x: 0,
            xanchor: 'right',
            text: '70',
            showarrow: false,
            font: { size: 10, color: '#F9FAFB' },
            yref: 'y3'
          },
          {
            y: 30,
            xref: 'paper',
            x: 0,
            xanchor: 'right',
            text: '30',
            showarrow: false,
            font: { size: 10, color: '#F9FAFB' },
            yref: 'y3'
          }
        ],
        height: 900,
        margin: { t: 100, b: 50, l: 70, r: 20 },
        font: { color: '#F9FAFB' }
      }}
      style={{ width: '100%' }}
      config={{ responsive: true }}
    />
  );
};

export default StockChart;