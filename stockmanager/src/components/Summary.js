import React, { useMemo, useState, useEffect } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import './Summary.css';

// Chart.js 컴포넌트 등록
ChartJS.register(ArcElement, Tooltip, Legend, ChartDataLabels);

const Summary = ({ stocks }) => {
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

    // 섹터별 비중
    const sectorData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const sector = stock.sector || '미분류';
      acc[sector] = (acc[sector] || 0) + parseFloat(stock.weight || 0);
      return acc;
    }, {});

    // 카테고리별 비중
    const categoryData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const category = stock.category || '미분류';
      acc[category] = (acc[category] || 0) + parseFloat(stock.weight || 0);
      return acc;
    }, {});

    // 외화/원화 비중
    const currencyData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const isUSStock = !/^\d+$/.test(stock.ticker);
      const type = isUSStock ? 'USD' : 'KRW';
      acc[type] = (acc[type] || 0) + parseFloat(stock.weight || 0);
      return acc;
    }, {});

    // 변동성별 비중
    const volatilityData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const volatility = stock.volatility || '선택';
      acc[volatility] = (acc[volatility] || 0) + parseFloat(stock.weight || 0);
      return acc;
    }, {});

    // 전체 투자 현황
    const totalInvestment = validStocks.reduce((sum, stock) => {
      if (!stock.trades.length) return sum;
      const isUSStock = !/^\d+$/.test(stock.ticker);
      
      return sum + stock.trades.reduce((acc, trade) => {
        const amount = parseFloat(trade.price) * parseFloat(trade.quantity);
        // API에서 가져온 환율 사용
        return acc + (isUSStock ? amount * exchangeRate : amount);
      }, 0);
    }, 0);

    const totalValue = validStocks.reduce((sum, stock) => {
      if (!stock.trades.length) return sum;
      return sum + parseFloat(stock.valueInKRW || 0);
    }, 0);

    const totalProfit = validStocks.reduce((sum, stock) => {
      if (!stock.trades.length) return sum;
      return sum + parseFloat(stock.profit || 0);
    }, 0);

    const totalProfitRate = (totalProfit / totalInvestment) * 100;

    // 수익/손실 종목 개수 계산
    const profitStocks = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const profit = parseFloat(stock.profit || 0);
      return {
        positive: acc.positive + (profit > 0 ? 1 : 0),
        negative: acc.negative + (profit < 0 ? 1 : 0)
      };
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
      profitStocks
    };
  }, [stocks, exchangeRate]); // exchangeRate를 의존성 배열에 추가

  const createChartData = (data, label) => ({
    labels: Object.keys(data),
    datasets: [{
      label,
      data: Object.values(data),
      backgroundColor: [
        '#FF6384',
        '#36A2EB',
        '#FFCE56',
        '#4BC0C0',
        '#9966FF',
        '#FF9F40'
      ]
    }]
  });

  // 차트 옵션 수정
  const chartOptions = {
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          font: {
            size: 12
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.raw || 0;
            const actualValue = Math.round((value / 100) * summaryData.totalValue);
            return `${label}: ${actualValue.toLocaleString()}원 (${value.toFixed(1)}%)`;
          }
        }
      },
      datalabels: {
        display: true,
        color: '#000',
        font: {
          weight: 'bold',
          size: 12
        },
        formatter: (value, context) => {
          const label = context.chart.data.labels[context.dataIndex];
          return `${label}\n${value.toFixed(1)}%`;
        },
        align: 'center',
        anchor: 'center',
        textAlign: 'center'
      }
    }
  };

  return (
    <div className="summary-container">
      <div className="summary-header">
        <h2>포트폴리오 요약</h2>
      </div>
      
      <div className="investment-summary">
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
          <div className="total-count">
            총 {summaryData.profitStocks.positive + summaryData.profitStocks.negative}종목
          </div>
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
