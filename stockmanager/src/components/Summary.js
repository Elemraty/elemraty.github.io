import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import './Summary.css';
import { auth } from '../firebase';
import { getDatabase, ref, get } from 'firebase/database';

// Chart.js 컴포넌트 등록
ChartJS.register(ArcElement, Tooltip, Legend, ChartDataLabels);

// props에서 cashKRW와 cashUSD 제거하고 stocks만 받음
const Summary = ({ stocks }) => {
  const [exchangeRate, setExchangeRate] = useState(1450); // 기본값 설정
  const [cashKRW, setCashKRW] = useState(null);
  const [cashUSD, setCashUSD] = useState(null);


  // 환율 정보 가져오기
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

  // 현금 정보 가져오기 함수를 useCallback으로 분리
  const fetchCashInfo = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const db = getDatabase();
      const cashKRWRef = ref(db, `users/${user.uid}/cash_krw`);
      const cashUSDRef = ref(db, `users/${user.uid}/cash_usd`);
      
      const cashKRWSnapshot = await get(cashKRWRef);
      const cashUSDSnapshot = await get(cashUSDRef);
      
      if (cashKRWSnapshot.exists()) {
        setCashKRW(cashKRWSnapshot.val());
      } else {
        setCashKRW({ amount: 0, valueInKRW: '0' });
      }
      
      if (cashUSDSnapshot.exists()) {
        setCashUSD(cashUSDSnapshot.val());
      } else {
        setCashUSD({ amount: 0, valueInKRW: '0' });
      }
    } catch (error) {
      console.error('현금 정보를 가져오는데 실패했습니다:', error);
    }
  }, []);

  // 컴포넌트 마운트 시와 stocks 변경 시 현금 정보 가져오기
  useEffect(() => {
    fetchCashInfo();
    
    // 10초마다 현금 정보 업데이트 (실시간 반영을 위해)
    const interval = setInterval(fetchCashInfo, 10000);
    
    return () => clearInterval(interval);
  }, [fetchCashInfo, stocks]); // stocks가 변경될 때마다 현금 정보도 다시 가져옴

  const summaryData = useMemo(() => {
    if (!stocks || !cashKRW || !cashUSD) return null;
    
    // 유효한 주식만 필터링
    const validStocks = stocks.filter(stock => 
      stock && Array.isArray(stock.trades) && stock.trades.length > 0
    );

    // 현금 금액 계산 - DB에서 가져온 데이터 활용
    const cashKRWAmount = parseFloat(cashKRW.amount) || 0;
    const cashUSDInKRW = parseFloat(cashUSD.valueInKRW) || 0;
    const totalCashAmount = cashKRWAmount + cashUSDInKRW;

    // 총 투자금액 계산 - 테이블 탭과 동일한 방식으로 계산
    let totalInvestment = 0;
    
    validStocks.forEach(stock => {
      const trades = Array.isArray(stock.trades) ? [...stock.trades] : [];
      // 날짜순으로 정렬
      trades.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      const isUSStock = !/^\d+$/.test(stock.ticker);
      
      // 시간순으로 거래를 처리하며 현재 보유 수량과 투자원금 계산
      let currentQuantity = 0;
      let stockInvestment = 0;
      
      trades.forEach(trade => {
        const price = parseFloat(trade.price);
        const quantity = parseFloat(trade.quantity);
        
        if (trade.type === 'buy') {
          // 매수: 수량과 투자원금 증가
          currentQuantity += quantity;
          stockInvestment += isUSStock ? price * quantity * exchangeRate : price * quantity;
        } else if (trade.type === 'sell' && currentQuantity > 0) {
          // 매도: 수량과 투자원금 감소 (평균매수가 기준)
          const avgPrice = currentQuantity > 0 ? stockInvestment / currentQuantity : 0;
          const sellAmount = quantity * avgPrice;
          
          currentQuantity -= quantity;
          // 매도 시 투자원금 감소 (평균매수가 기준)
          stockInvestment = currentQuantity > 0 ? stockInvestment - sellAmount : 0;
        }
      });
      
      // 현재 보유 수량이 있는 경우만 총 투자금액에 합산
      if (currentQuantity > 0) {
        totalInvestment += stockInvestment;
      }
    });

    // 총 평가금액 계산 (valueInKRW 사용)
    const totalValue = validStocks.reduce((sum, stock) => {
      return sum + parseFloat(stock.valueInKRW || 0);
    }, 0);

    // 총 자산 가치 (주식 + 현금)
    const totalAssetValue = totalValue + totalCashAmount;

    // 총 손익 및 수익률 계산
    const totalProfit = totalValue - totalInvestment;
    const totalProfitRate = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;

    // 수익/손실 종목 수 계산
    const profitStocks = validStocks.reduce((acc, stock) => {
      const profit = parseFloat(stock.profit || 0);
      if (profit > 0) acc.positive++;
      else if (profit < 0) acc.negative++;
      return acc;
    }, { positive: 0, negative: 0 });

    // 섹터별 비중
    const sectorData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const sector = stock.sector || '미분류';
      const weight = parseFloat(stock.weight || 0);
      if (weight > 0) acc[sector] = (acc[sector] || 0) + weight;
      return acc;
    }, {});

    // 섹터별 금액
    const sectorAmounts = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const sector = stock.sector || '미분류';
      const value = parseFloat(stock.valueInKRW || 0);
      if (value > 0) acc[sector] = (acc[sector] || 0) + value;
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
    
    // 카테고리별 금액
    const categoryAmounts = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const category = stock.category || '미분류';
      const value = parseFloat(stock.valueInKRW || 0);
      if (value > 0) acc[category] = (acc[category] || 0) + value;
      return acc;
    }, {});
    
    // 현금 카테고리 추가 (원화와 달러 구분) - 수정
    const categoryDataWithCash = { ...categoryData };
    const categoryAmountsWithCash = { ...categoryAmounts };

    if (cashKRW && parseFloat(cashKRW.weight) > 0) {
      categoryDataWithCash['현금(원화)'] = parseFloat(cashKRW.weight);
      categoryAmountsWithCash['현금(원화)'] = cashKRWAmount;
    }

    if (cashUSD && parseFloat(cashUSD.weight) > 0) {
      categoryDataWithCash['현금(달러)'] = parseFloat(cashUSD.weight);
      categoryAmountsWithCash['현금(달러)'] = cashUSDInKRW;
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
    
    // 외화/원화 금액
    const currencyAmounts = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const isUSStock = !/^\d+$/.test(stock.ticker);
      const type = isUSStock ? 'USD' : 'KRW';
      const value = parseFloat(stock.valueInKRW || 0);
      if (value > 0) acc[type] = (acc[type] || 0) + value;
      return acc;
    }, {});
    
    // 현금 통화 추가
    if (cashKRW && parseFloat(cashKRW.weight) > 0) {
      currencyData['KRW'] = (currencyData['KRW'] || 0) + parseFloat(cashKRW.weight);
      currencyAmounts['KRW'] = (currencyAmounts['KRW'] || 0) + cashKRWAmount;
    }
    
    if (cashUSD && parseFloat(cashUSD.weight) > 0) {
      currencyData['USD'] = (currencyData['USD'] || 0) + parseFloat(cashUSD.weight);
      currencyAmounts['USD'] = (currencyAmounts['USD'] || 0) + cashUSDInKRW;
    }

    // 변동성별 비중
    const volatilityData = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const volatility = stock.volatility || '미분류';
      const weight = parseFloat(stock.weight || 0);
      if (weight > 0) acc[volatility] = (acc[volatility] || 0) + weight;
      return acc;
    }, {});
    
    // 변동성별 금액
    const volatilityAmounts = validStocks.reduce((acc, stock) => {
      if (!stock.trades.length) return acc;
      const volatility = stock.volatility || '미분류';
      const value = parseFloat(stock.valueInKRW || 0);
      if (value > 0) acc[volatility] = (acc[volatility] || 0) + value;
      return acc;
    }, {});
    
    // 현금 변동성 추가 (안정적)
    if ((cashKRW && parseFloat(cashKRW.weight) > 0) || (cashUSD && parseFloat(cashUSD.weight) > 0)) {
      const cashWeight = (parseFloat(cashKRW.weight) || 0) + (parseFloat(cashUSD.weight) || 0);
      volatilityData['안정적'] = (volatilityData['안정적'] || 0) + cashWeight;
      volatilityAmounts['안정적'] = (volatilityAmounts['안정적'] || 0) + totalCashAmount;
    }

    return {
      totalInvestment,
      totalValue,
      totalAssetValue,
      totalProfit,
      totalProfitRate,
      profitStocks,
      sectorData,
      sectorAmounts,
      categoryData: categoryDataWithCash,
      categoryAmounts: categoryAmountsWithCash,
      currencyData,
      currencyAmounts,
      volatilityData,
      volatilityAmounts
    };
  }, [stocks, cashKRW, cashUSD, exchangeRate]);

  // 차트 데이터 생성 함수 수정 - 데이터 정규화 추가
  const createChartData = (data, label, amounts = {}) => {
    const labels = Object.keys(data);
    const rawValues = Object.values(data);
    
    // 값의 총합 계산
    const total = rawValues.reduce((sum, value) => sum + value, 0);
    
    // 총합이 100%가 되도록 정규화
    const values = rawValues.map(value => (value / total) * 100);
    
    // 원래 차트 색상 유지
    const backgroundColors = [
      'rgba(255, 99, 132, 0.7)',
      'rgba(54, 162, 235, 0.7)',
      'rgba(255, 206, 86, 0.7)',
      'rgba(75, 192, 192, 0.7)',
      'rgba(153, 102, 255, 0.7)',
      'rgba(255, 159, 64, 0.7)',
      'rgba(199, 199, 199, 0.7)',
      'rgba(83, 102, 255, 0.7)',
      'rgba(40, 159, 64, 0.7)',
      'rgba(210, 199, 199, 0.7)',
      'rgba(78, 52, 199, 0.7)',
    ];
    
    const borderColors = backgroundColors.map(color => color.replace('0.7', '1'));
    
    return {
      labels,
      datasets: [
        {
          label,
          data: values,
          backgroundColor: backgroundColors.slice(0, labels.length),
          borderColor: borderColors.slice(0, labels.length),
          borderWidth: 1,
          // 금액 데이터 추가
          amounts: labels.map(key => amounts[key] || 0)
        }
      ]
    };
  };

  // 차트 옵션 수정 - 라벨과 수치 함께 표시
  const chartOptions = {
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          boxWidth: 15,
          padding: 15
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.raw || 0;
            const amount = context.dataset.amounts ? 
              context.dataset.amounts[context.dataIndex] : 0;
            return `${label}: ${value.toFixed(1)}% (${Math.round(amount).toLocaleString()}원)`;
          }
        }
      },
      datalabels: {
        formatter: (value, ctx) => {
          if (value < 3) return ''; // 3% 미만은 라벨 표시 안함
          
          const label = ctx.chart.data.labels[ctx.dataIndex];
          return `${label}: ${value.toFixed(1)}%`;
        },
        color: '#fff',
        font: {
          weight: 'bold',
          size: 10
        },
        // 텍스트가 잘 보이도록 배경 추가
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 4,
        padding: {
          top: 3,
          bottom: 3,
          left: 5,
          right: 5
        },
        // 라벨이 차트 밖으로 나가지 않도록 설정
        display: function(context) {
          const value = context.dataset.data[context.dataIndex];
          return value > 3; // 3% 이상인 항목만 라벨 표시
        }
      }
    },
    maintainAspectRatio: true,
    layout: {
      padding: {
        bottom: 20
      }
    }
  };

  // 데이터가 없는 경우 로딩 표시
  if (!summaryData) {
    return <div className="loading">데이터를 불러오는 중...</div>;
  }

  return (
    <div className="summary-container">
      <div className="summary-header">
        <h2>포트폴리오 요약</h2>
      </div>

      <div className="investment-summary">
        <div className="summary-item">
          <h3>전체 보유자산</h3>
          <p>{Math.round(summaryData.totalAssetValue).toLocaleString()}원</p>
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
            data={createChartData(summaryData.sectorData, '섹터별 비중', summaryData.sectorAmounts)} 
            options={chartOptions}
          />
        </div>
        <div className="chart-item">
          <h3>카테고리별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.categoryData, '카테고리별 비중', summaryData.categoryAmounts)} 
            options={chartOptions}
          />
        </div>
        <div className="chart-item">
          <h3>통화별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.currencyData, '통화별 비중', summaryData.currencyAmounts)} 
            options={chartOptions}
          />
        </div>
        <div className="chart-item">
          <h3>변동성별 비중</h3>
          <Doughnut 
            data={createChartData(summaryData.volatilityData, '변동성별 비중', summaryData.volatilityAmounts)} 
            options={chartOptions}
          />
        </div>
      </div>
    </div>
  );
};

export default Summary;
