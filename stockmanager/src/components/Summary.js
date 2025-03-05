import React, { useMemo, useState, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import './Summary.css';

// Chart.js 컴포넌트 등록
ChartJS.register(ArcElement, Tooltip, Legend, ChartDataLabels);

const Summary = ({ stocks, cashAmount }) => {
  const [exchangeRate, setExchangeRate] = useState(1450); // 기본값 설정

  useEffect(() => {
    const fetchExchangeRate = async () => {
      try {
        const response = await fetch('https://visualp.p-e.kr/api/stock-price?ticker=KRW=X');
        const data = await response.json();
        if (data && data.price) {
          setExchangeRate(parseFloat(data.price));
        }
      } catch (error) {
        console.error('환율 정보를 가져오는데 실패했습니다:', error);
      }
    };

    fetchExchangeRate();
  }, []); // 컴포넌트 마운트 시 한 번만 실행

  const summaryData = useMemo(() => {
    // 배열이 아닌 trades 처리
    const validStocks = stocks.map(stock => ({
      ...stock,
      trades: Array.isArray(stock.trades) ? stock.trades : []
    }));

    // 먼저 totalValue 계산
    const totalValue = validStocks.reduce((sum, stock) => {
      if (!stock.trades.length) return sum;
      return sum + parseFloat(stock.valueInKRW || 0);
    }, 0);

    // 총 자산 가치 (주식 + 현금)
    const totalAssetValue = totalValue + cashAmount;

    // 초기 투자 날짜 찾기 (가장 오래된 거래)
    let firstTradeDate = new Date();
    validStocks.forEach(stock => {
      if (!stock.trades.length) return;
      
      stock.trades.forEach(trade => {
        if (trade.type === 'buy') {
          const tradeDate = new Date(trade.date);
          if (tradeDate < firstTradeDate) {
            firstTradeDate = tradeDate;
          }
        }
      });
    });
    
    // 투자 기간 계산 (년 단위)
    const currentDate = new Date();
    const yearDiff = (currentDate - firstTradeDate) / (1000 * 60 * 60 * 24 * 365);

    // 섹터별 비중
    const sectorData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const sector = stock.sector || '미분류';
      const weight = parseFloat(stock.weight || 0);
      if (weight > 0) acc[sector] = (acc[sector] || 0) + weight;
      return acc;
    }, {});

    // 카테고리별 비중 (현금 포함)
    const categoryData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const category = stock.category || '미분류';
      const weight = parseFloat(stock.weight || 0);
      if (weight > 0) acc[category] = (acc[category] || 0) + weight;
      return acc;
    }, {});
    
    // 현금 카테고리 추가
    if (cashAmount > 0) {
      const cashWeight = (cashAmount / totalAssetValue) * 100;
      categoryData['현금'] = (categoryData['현금'] || 0) + cashWeight;
    }

    // 외화/원화 비중
    const currencyData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const isUSStock = !/^\d+$/.test(stock.ticker);
      const type = isUSStock ? 'USD' : 'KRW';
      const weight = parseFloat(stock.weight || 0);
      if (weight > 0) acc[type] = (acc[type] || 0) + weight;
      return acc;
    }, {});
    
    // 현금은 KRW에 추가
    if (cashAmount > 0) {
      const cashWeight = (cashAmount / totalAssetValue) * 100;
      currencyData['KRW'] = (currencyData['KRW'] || 0) + cashWeight;
    }

    // 변동성별 비중 (현금 포함)
    const volatilityData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const volatility = stock.volatility || '선택';
      const weight = parseFloat(stock.weight || 0);
      if (weight > 0) acc[volatility] = (acc[volatility] || 0) + weight;
      return acc;
    }, {});
    
    // 현금은 안정적 변동성에 추가
    if (cashAmount > 0) {
      const cashWeight = (cashAmount / totalAssetValue) * 100;
      volatilityData['안정적'] = (volatilityData['안정적'] || 0) + cashWeight;
    }

    // 전체 투자 현황
    const totalInvestment = validStocks.reduce((sum, stock) => {
      if (!stock.trades.length) return sum;
      const trades = stock.trades;
      const isUSStock = !/^\d+$/.test(stock.ticker);
      
      // 현재 보유 수량 계산
      const currentQuantity = trades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        if (t.type === 'sell') return sum - parseFloat(t.quantity);
        return sum;
      }, 0);

      // 현재 보유 수량이 있는 경우만 계산
      if (currentQuantity > 0) {
        // 매수 거래만 고려하여 평균매수가 계산
        const totalBuyCost = trades.reduce((sum, t) => {
          if (t.type === 'buy') {
            const amount = parseFloat(t.price) * parseFloat(t.quantity);
            return sum + (isUSStock ? amount * exchangeRate : amount);
          }
          return sum;
        }, 0);

        const totalBuyQuantity = trades.reduce((sum, t) => {
          if (t.type === 'buy') {
            return sum + parseFloat(t.quantity);
          }
          return sum;
        }, 0);

        // 평균 매수가
        const avgBuyPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
        
        // 현재 보유 수량에 대한 투자금액
        const currentInvestment = avgBuyPrice * currentQuantity;
        
        return sum + currentInvestment;
      }
      return sum;
    }, 0);

    const totalProfit = validStocks.reduce((sum, stock) => {
      if (!stock.trades.length) return sum;
      const trades = stock.trades;
      const isUSStock = !/^\d+$/.test(stock.ticker);
      
      // 현재 보유 수량 계산
      const currentQuantity = trades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        if (t.type === 'sell') return sum - parseFloat(t.quantity);
        return sum;
      }, 0);

      if (currentQuantity > 0) {
        // 매수 거래만 고려하여 평균매수가 계산
        const totalBuyCost = trades.reduce((sum, t) => {
          if (t.type === 'buy') {
            const amount = parseFloat(t.price) * parseFloat(t.quantity);
            return sum + (isUSStock ? amount * exchangeRate : amount);
          }
          return sum;
        }, 0);

        const totalBuyQuantity = trades.reduce((sum, t) => {
          if (t.type === 'buy') {
            return sum + parseFloat(t.quantity);
          }
          return sum;
        }, 0);

        // 평균 매수가
        const avgBuyPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
        
        // 현재 보유 수량에 대한 투자금액
        const currentInvestment = avgBuyPrice * currentQuantity;
        
        // 평가금액
        const evaluationValue = parseFloat(stock.valueInKRW || 0);
        
        return sum + (evaluationValue - currentInvestment);
      }
      return sum;
    }, 0);

    // 수익률 계산
    const totalProfitRate = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

    // 복리 수익률 계산 (CAGR) - totalInvestment 계산 후로 이동
    let cagr = 0;
    if (yearDiff > 0 && totalInvestment > 0) {
      cagr = Math.pow(totalAssetValue / totalInvestment, 1 / yearDiff) - 1;
      cagr = cagr * 100; // 백분율로 변환
    }

    // 수익/손실 종목 수 계산
    const profitStocks = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      
      const trades = stock.trades;
      const currentQuantity = trades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        if (t.type === 'sell') return sum - parseFloat(t.quantity);
        return sum;
      }, 0);

      if (currentQuantity > 0) {
        const profitRate = parseFloat(stock.profitRate || 0);
        if (profitRate > 0) {
          acc.positive++;
        } else if (profitRate < 0) {
          acc.negative++;
        }
      }
      
      return acc;
    }, { positive: 0, negative: 0 });

    return {
      sectorData,
      categoryData,
      currencyData,
      volatilityData,
      totalInvestment,
      totalValue,
      totalProfit,
      totalProfitRate,
      profitStocks,
      cagr,
      investmentPeriod: yearDiff
    };
  }, [stocks, exchangeRate, cashAmount]);

  // 차트 데이터 생성 함수
  const createChartData = (data, label) => {
    const labels = Object.keys(data);
    const values = Object.values(data);
    const backgroundColors = [
      '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', 
      '#FF9F40', '#8AC926', '#1982C4', '#6A4C93', '#FF595E',
      '#FFCA3A', '#8AC926', '#1982C4', '#6A4C93', '#FF595E'
    ];
    
    return {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: backgroundColors.slice(0, labels.length),
          borderWidth: 1
        }
      ]
    };
  };

  // 차트 옵션
  const chartOptions = {
    plugins: {
      legend: {
        position: 'right',
        labels: {
          font: {
            weight: 'bold',
            size: 12
          },
          color: '#333'
        }
      },
      datalabels: {
        formatter: (value, ctx) => {
          const label = ctx.chart.data.labels[ctx.dataIndex];
          const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
          const percentage = (value * 100 / sum).toFixed(1) + '%';
          return `${label}${percentage}`;
        },
        color: '#fff',
        font: {
          weight: 'bold',
          size: 11
        }
      }
    },
    maintainAspectRatio: true
  };

  // 총 자산 계산
  const totalAssets = summaryData.totalValue + cashAmount;

  return (
    <div className="summary-container">
      <div className="summary-header">
        <h2>포트폴리오 요약</h2>
      </div>

      <div className="investment-summary">
        <div className="summary-item">
          <h3>전체 보유자산</h3>
          <p>{Math.round(totalAssets).toLocaleString()}원</p>
        </div>
        <div className="summary-item">
          <h3>총 투자금액</h3>
          <p>{Math.round(summaryData.totalInvestment).toLocaleString()}원</p>
        </div>
        <div className="summary-item">
          <h3>총 평가금액</h3>
          <p>{Math.round(summaryData.totalValue).toLocaleString()}원</p>
        </div>
        <div className="summary-item">
          <h3>총 평가손익</h3>
          <p style={{ color: summaryData.totalProfit > 0 ? 'red' : 'blue' }}>
            {summaryData.totalProfit > 0 ? '+' : ''}
            {Math.round(summaryData.totalProfit).toLocaleString()}원
          </p>
        </div>
        <div className="summary-item">
          <h3>총 수익률</h3>
          <p style={{ color: summaryData.totalProfitRate > 0 ? 'red' : 'blue' }}>
            {summaryData.totalProfitRate > 0 ? '+' : ''}
            {summaryData.totalProfitRate.toFixed(2)}%
          </p>
        </div>
        <div className="summary-item">
          <h3>연평균 복리수익률</h3>
          <p style={{ color: summaryData.cagr > 0 ? 'red' : 'blue' }}>
            {summaryData.cagr > 0 ? '+' : ''}
            {summaryData.cagr.toFixed(2)}%
            <span className="investment-period">
              (투자기간: {summaryData.investmentPeriod.toFixed(1)}년)
            </span>
          </p>
        </div>
      </div>

      <div className="profit-count-summary">
        <div className="profit-count-item profit">
          <div className="count-circle profit">
            <span className="count">{summaryData.profitStocks.positive}</span>
            <span className="label">수익</span>
          </div>
          <div className="count-details">
            <h3>수익 종목</h3>
            <p className="percentage">
              {((summaryData.profitStocks.positive / 
                (summaryData.profitStocks.positive + summaryData.profitStocks.negative)) * 100).toFixed(1)}%
            </p>
          </div>
        </div>
        
        <div className="profit-count-divider">
          <div className="divider-line"></div>
          <span className="total-count">총 {summaryData.profitStocks.positive + summaryData.profitStocks.negative}종목</span>
          <div className="divider-line"></div>
        </div>
        
        <div className="profit-count-item loss">
          <div className="count-circle loss">
            <span className="count">{summaryData.profitStocks.negative}</span>
            <span className="label">손실</span>
          </div>
          <div className="count-details">
            <h3>손실 종목</h3>
            <p className="percentage">
              {((summaryData.profitStocks.negative / 
                (summaryData.profitStocks.positive + summaryData.profitStocks.negative)) * 100).toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      <div className="charts-container">
        <div className="chart-item">
          <h3>섹터별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.sectorData, '섹터별 비중')} 
            options={chartOptions}
          />
        </div>
        <div className="chart-item">
          <h3>카테고리별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.categoryData, '카테고리별 비중')} 
            options={chartOptions}
          />
        </div>
        <div className="chart-item">
          <h3>통화별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.currencyData, '통화별 비중')} 
            options={chartOptions}
          />
        </div>
        <div className="chart-item">
          <h3>변동성별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.volatilityData, '변동성별 비중')} 
            options={chartOptions}
          />
        </div>
      </div>
    </div>
  );
};

export default Summary;
