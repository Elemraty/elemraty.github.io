import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { auth } from '../firebase';
import { getDatabase, ref, set, get } from 'firebase/database';
import './StockTable.css';
import { parse } from 'papaparse';
import StockChart from './StockChart';

// 컴포넌트 외부에 areEqual 함수 정의
const areEqual = (prevProps, nextProps) => {
  return JSON.stringify(prevProps.stocks) === JSON.stringify(nextProps.stocks);
};

// 상단에 변동성 옵션 상수 추가
const VOLATILITY_OPTIONS = ['선택', '변동적', '중립적', '안정적'];
const response = await fetch('https://visualp.p-e.kr/api/stock-price?ticker=KRW=X');
const data = await response.json();
const usdToKrw = parseFloat(data.price) || 1450;

const StockTable = ({ stocks, onCashUpdate, onStocksUpdate }) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [selectedStock, setSelectedStock] = useState(null);
  const [newStock, setNewStock] = useState({
    ticker: '',
    sector: '',
    category: '',
    volatility: '선택'
  });
  const [newTrade, setNewTrade] = useState({
    date: new Date().toISOString().split('T')[0],
    price: '',
    quantity: '',
    memo: '',
    type: 'buy'  // 'buy' 또는 'sell'
  });
  const updateTimeoutRef = useRef(null);
  const lastUpdateRef = useRef(Date.now());
  const [showChart, setShowChart] = useState(false);
  const [editingCell, setEditingCell] = useState({ ticker: null, field: null });
  const [editValue, setEditValue] = useState('');
  const [showCompanyInfo, setShowCompanyInfo] = useState(false);
  const [editingTrade, setEditingTrade] = useState(null);
  const [showEditTradeModal, setShowEditTradeModal] = useState(false);
  const [editTradeForm, setEditTradeForm] = useState({
    price: '',
    quantity: '',
    type: 'buy'  // type 필드 추가
  });
  const [sortConfig, setSortConfig] = useState({
    key: 'weight',
    direction: 'descending'
  });

  // 현금 관련 state 수정 - 원화와 달러 분리
  const [cashKRW, setCashKRW] = useState({
    amount: 0,
    category: '현금',
    currency: 'KRW',
    lastUpdated: new Date().toISOString(),
    valueInKRW: '0',
    volatility: '안정적',
    weight: '0.00'
  });

  const [cashUSD, setCashUSD] = useState({
    amount: 0,
    category: '현금',
    currency: 'USD',
    lastUpdated: new Date().toISOString(),
    valueInKRW: '0',
    volatility: '안정적',
    weight: '0.00'
  });

  // 현금 모달 관련 state 수정
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashForm, setCashForm] = useState({
    amount: '',
    description: '',
    currency: 'KRW',
    date: new Date().toISOString().split('T')[0] // 오늘 날짜를 기본값으로 설정
  });

  // 호환성을 위해 유지하되 실제로 사용하는 곳이 있는지 확인 필요
  // eslint-disable-next-line no-unused-vars
  const [cashAmount, setCashAmount] = useState(0);
  // eslint-disable-next-line no-unused-vars
  const [cashWeight, setCashWeight] = useState(0);

  // state 추가
  const [showMemoModal, setShowMemoModal] = useState(false);
  const [memos, setMemos] = useState([]);
  const [newMemo, setNewMemo] = useState({
    content: '',
    date: new Date().toISOString().split('T')[0]
  });

  // state 추가
  const [editingMemo, setEditingMemo] = useState(null);

  // 선택된 월을 저장할 state 추가
  const [selectedMonth, setSelectedMonth] = useState('');

  // 총계 계산을 위한 useMemo 수정 - 정확한 평균 매수가 계산
  const totals = useMemo(() => {
    const validStocks = stocks.filter(stock => Array.isArray(stock.trades) && stock.trades.length > 0);
    
    return validStocks.reduce((acc, stock) => {
      const trades = Array.isArray(stock.trades) ? [...stock.trades] : [];
      // 날짜순으로 정렬
      trades.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // eslint-disable-next-line no-unused-vars
      const isUSStock = !/^\d+$/.test(stock.ticker);
      
      // 시간순으로 거래를 처리하며 현재 보유 수량과 투자원금 계산
      let currentQuantity = 0;
      let totalInvestment = 0;
      
      trades.forEach(trade => {
        const price = parseFloat(trade.price);
        const quantity = parseFloat(trade.quantity);
        
        if (trade.type === 'buy') {
          // 매수: 수량과 투자원금 증가
          currentQuantity += quantity;
          totalInvestment += isUSStock ? price * quantity * usdToKrw : price * quantity;
        } else if (trade.type === 'sell' && currentQuantity > 0) {
          // 매도: 수량과 투자원금 감소 (평균매수가 기준)
          const avgPrice = currentQuantity > 0 ? totalInvestment / currentQuantity : 0;
          const sellAmount = quantity * avgPrice; // 평균매수가 기준 매도 금액
          
          currentQuantity -= quantity;
          // 매도 시 투자원금 감소 (평균매수가 기준)
          totalInvestment = currentQuantity > 0 ? totalInvestment - sellAmount : 0;
        }
      });
      
      if (currentQuantity > 0) {
        // 평가금액
        const evaluationValue = parseFloat(stock.valueInKRW || 0);
        
        acc.totalInvestment += totalInvestment;
        acc.totalEvaluation += evaluationValue;
      }
      
      return acc;
    }, { totalInvestment: 0, totalEvaluation: 0 });
  }, [stocks]);

  // updateCashAmount를 useCallback으로 감싸고 최상단으로 이동
  // eslint-disable-next-line no-unused-vars
  const updateCashAmount = useCallback((amount) => {
    setCashAmount(amount);
    onCashUpdate(amount);
  }, [onCashUpdate]);

  // 정렬 함수 수정 - 보유 주식 우선 정렬
  const requestSort = (key) => {
    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
      direction = 'ascending';
    }
    setSortConfig({ key, direction });
  };

  // 정렬된 데이터 가져오기 - 보유 주식 우선 표시하도록 수정
  const getSortedStocks = (stocksToSort) => {
    if (!sortConfig.key) return stocksToSort;

    // 주식 목록 복사
    const stocksCopy = [...stocksToSort];
    
    // 각 주식의 현재 보유 수량 계산
    const stocksWithHoldingInfo = stocksCopy.map(stock => {
      // 거래 내역 정렬 (날짜순)
      const trades = Array.isArray(stock.trades) ? [...stock.trades] : [];
      trades.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // eslint-disable-next-line no-unused-vars
      const isUSStock = !/^\d+$/.test(stock.ticker);
      
      // 시간순으로 거래를 처리하며 현재 보유 수량과 투자원금 계산
      let currentQuantity = 0;
      let totalInvestment = 0;
      
      trades.forEach(trade => {
        const price = parseFloat(trade.price);
        const quantity = parseFloat(trade.quantity);
        
        if (trade.type === 'buy') {
          // 매수: 수량과 투자원금 증가
          currentQuantity += quantity;
          totalInvestment += isUSStock ? price * quantity * usdToKrw : price * quantity;
        } else if (trade.type === 'sell' && currentQuantity > 0) {
          // 매도: 수량과 투자원금 감소 (평균매수가 기준)
          const avgPrice = currentQuantity > 0 ? totalInvestment / currentQuantity : 0;
          const sellAmount = quantity * avgPrice; // 평균매수가 기준 매도 금액
          
          currentQuantity -= quantity;
          // 매도 시 투자원금 감소 (평균매수가 기준)
          totalInvestment = currentQuantity > 0 ? totalInvestment - sellAmount : 0;
        }
      });
      
      // 보유 여부 플래그 추가
      return {
        ...stock,
        _isHolding: currentQuantity > 0,
        _currentQuantity: currentQuantity,
        _totalInvestment: totalInvestment
      };
    });
    
    // 기존 정렬 로직 적용
    const sortedStocks = [...stocksWithHoldingInfo].sort((a, b) => {
      // 먼저 보유 여부로 정렬 (보유 주식이 항상 상단에)
      if (a._isHolding && !b._isHolding) return -1;
      if (!a._isHolding && b._isHolding) return 1;
      
      // 보유 여부가 같으면 기존 정렬 기준 적용
      let aValue, bValue;
      
      switch(sortConfig.key) {
        case 'sector':
        case 'category':
        case 'volatility':
          aValue = a[sortConfig.key] || '';
          bValue = b[sortConfig.key] || '';
          break;
        case 'totalInvestment':
          aValue = a._totalInvestment || 0;
          bValue = b._totalInvestment || 0;
          break;
        case 'avgPrice':
          aValue = a._currentQuantity > 0 ? a._totalInvestment / a._currentQuantity : 0;
          bValue = b._currentQuantity > 0 ? b._totalInvestment / b._currentQuantity : 0;
          break;
        case 'currentPrice':
          aValue = parseFloat(a.currentPrice) || 0;
          bValue = parseFloat(b.currentPrice) || 0;
          break;
        case 'evaluationValue':
          aValue = parseFloat(a.valueInKRW) || 0;
          bValue = parseFloat(b.valueInKRW) || 0;
          break;
        case 'profit':
          aValue = (parseFloat(a.valueInKRW) || 0) - a._totalInvestment;
          bValue = (parseFloat(b.valueInKRW) || 0) - b._totalInvestment;
          break;
        case 'profitRate':
          aValue = a._totalInvestment > 0 ? (((parseFloat(a.valueInKRW) || 0) - a._totalInvestment) / a._totalInvestment) * 100 : 0;
          bValue = b._totalInvestment > 0 ? (((parseFloat(b.valueInKRW) || 0) - b._totalInvestment) / b._totalInvestment) * 100 : 0;
          break;
        case 'weight':
          aValue = parseFloat(a.weight) || 0;
          bValue = parseFloat(b.weight) || 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) {
        return sortConfig.direction === 'ascending' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'ascending' ? 1 : -1;
      }
      return 0;
    });
    
    return sortedStocks;
  };

  // 정렬 방향 표시 아이콘
  const getSortDirectionIcon = (key) => {
    if (sortConfig.key !== key) return '↕️';
    return sortConfig.direction === 'ascending' ? '↑' : '↓';
  };

  // 비중 재계산 함수 수정 - 전체 합계에 대한 정확한 비중 계산
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recalculateWeights = useCallback(async () => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      
      // 모든 주식 데이터 가져오기
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const stocksSnapshot = await get(stocksRef);
      
      if (!stocksSnapshot.exists()) return;
      
      const stocksData = stocksSnapshot.val();
      
      // 현금 데이터 가져오기
      const cashKRWRef = ref(db, `users/${userId}/cash_krw`);
      const cashUSDRef = ref(db, `users/${userId}/cash_usd`);
      
      const cashKRWSnapshot = await get(cashKRWRef);
      const cashUSDSnapshot = await get(cashUSDRef);
      
      const cashKRWAmount = cashKRWSnapshot.exists() ? parseFloat(cashKRWSnapshot.val().amount) || 0 : 0;
      const cashUSDAmount = cashUSDSnapshot.exists() ? parseFloat(cashUSDSnapshot.val().amount) || 0 : 0;
      
      // 현금 원화 가치 계산
      const cashKRWValue = cashKRWAmount;
      const cashUSDValue = cashUSDAmount * usdToKrw;
      
      // 총 자산 가치 계산 (주식 + 현금)
      let totalValue = cashKRWValue + cashUSDValue;
      
      // 각 주식의 원화 가치 합산
      Object.values(stocksData).forEach(stock => {
        if (stock && stock.valueInKRW) {
          totalValue += parseFloat(stock.valueInKRW);
        }
      });
      
      // 각 주식 및 현금의 비중 계산 및 업데이트
      const updatePromises = [];
      
      // 주식 비중 업데이트
      Object.entries(stocksData).forEach(([ticker, stock]) => {
        if (stock && stock.valueInKRW) {
          const weight = (parseFloat(stock.valueInKRW) / totalValue) * 100;
          const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);
          updatePromises.push(set(stockRef, {
            ...stock,
            weight: weight.toFixed(2)
          }));
        }
      });
      
      // 현금 비중 업데이트
      if (cashKRWSnapshot.exists()) {
        const krwWeight = (cashKRWValue / totalValue) * 100;
        updatePromises.push(set(cashKRWRef, {
          ...cashKRWSnapshot.val(),
          weight: krwWeight.toFixed(2),
          valueInKRW: cashKRWValue.toFixed(0)
        }));
        
        // 상태 업데이트
        setCashKRW(prev => ({
          ...prev,
          weight: krwWeight.toFixed(2),
          valueInKRW: cashKRWValue.toFixed(0)
        }));
      }
      
      if (cashUSDSnapshot.exists()) {
        const usdWeight = (cashUSDValue / totalValue) * 100;
        updatePromises.push(set(cashUSDRef, {
          ...cashUSDSnapshot.val(),
          weight: usdWeight.toFixed(2),
          valueInKRW: cashUSDValue.toFixed(0)
        }));
        
        // 상태 업데이트
        setCashUSD(prev => ({
          ...prev,
          weight: usdWeight.toFixed(2),
          valueInKRW: cashUSDValue.toFixed(0)
        }));
      }
      
      // 모든 업데이트 완료 대기
      await Promise.all(updatePromises);
      
      console.log("Weights recalculated successfully");
    } catch (error) {
      console.error("Error recalculating weights:", error);
    }
  }, [setCashKRW, setCashUSD]); // usdToKrw 제거

  // updateStockPrices 함수도 recalculateWeights 아래로 이동
  const updateStockPrices = useCallback(async (existingTickers) => {
    if (!stocks || stocks.length === 0) return;

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const response = await fetch('https://visualp.p-e.kr/api/stock-price?ticker=KRW=X');
      const data = await response.json();
      const usdToKrw = data.price;

      // 현재 DB에 있는 주식 목록 확인
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const snapshot = await get(stocksRef);
      const existingStocks = snapshot.val() || {};

      const updatedStocks = await Promise.all(
        stocks
          .filter(stock => existingTickers.has(stock.ticker))
          .map(async (stock) => {
            try {
              if (!existingStocks[stock.ticker]) return null;

              const currentStockData = existingStocks[stock.ticker];
              const response = await fetch(`https://visualp.p-e.kr/api/stock-price?ticker=${stock.ticker}`);
              const data = await response.json();
              
              const isUSStock = !/^\d+$/.test(stock.ticker);
              let currentPrice = typeof data.price === 'string' ? 
                parseFloat(data.price.replace(/,/g, '')) : 
                parseFloat(data.price);

              if (isNaN(currentPrice)) {
                console.error('Invalid current price:', data.price);
                return currentStockData;
              }

              const trades = Array.isArray(currentStockData.trades) ? currentStockData.trades : [];
              
              // 현재 보유 수량 계산 (매수 - 매도)
              const currentQuantity = trades.reduce((sum, t) => {
                if (t.type === 'buy') return sum + parseFloat(t.quantity);
                if (t.type === 'sell') return sum - parseFloat(t.quantity);
                return sum;
              }, 0);

              // 매수 거래만 고려하여 평균매수가 계산
              const totalBuyCost = trades.reduce((sum, t) => {
                if (t.type === 'buy') return sum + (parseFloat(t.price) * parseFloat(t.quantity));
                return sum;
              }, 0);

              const totalBuyQuantity = trades.reduce((sum, t) => {
                if (t.type === 'buy') return sum + parseFloat(t.quantity);
                return sum;
              }, 0);

              const avgPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
              
              const profit = currentQuantity > 0 ? (currentPrice - avgPrice) * currentQuantity : 0;
              const profitRate = currentQuantity > 0 && avgPrice !== 0 ? 
                ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

              const valueInKRW = isUSStock ? 
                (currentPrice * currentQuantity * usdToKrw) : 
                (currentPrice * currentQuantity);

              return {
                ...currentStockData,
                currentPrice,
                profit: profit || 0,
                profitRate: profitRate.toFixed(2),
                valueInKRW: valueInKRW.toFixed(0),
                currentQuantity
              };
            } catch (error) {
              console.error(`Error updating ${stock.ticker}:`, error);
              return existingStocks[stock.ticker];
            }
          })
      );

      // null 값과 undefined 제거
      const filteredStocks = updatedStocks.filter(stock => stock !== null && stock !== undefined);

      // 각 주식 데이터 업데이트
      for (const stock of filteredStocks) {
        const stockRef = ref(db, `users/${userId}/stocks/${stock.ticker}`);
        await set(stockRef, stock);
      }

      // 비중 재계산
      await recalculateWeights();

    } catch (error) {
      console.error("Error updating stock prices:", error);
    }
  }, [stocks, recalculateWeights]);

  // 디바운스된 업데이트 함수
  const debouncedUpdateStockPrices = useCallback(() => {
    const now = Date.now();
    const timeSinceLastUpdate = now - lastUpdateRef.current;
    
    if (timeSinceLastUpdate >= 60000) {  // 1분 = 60000ms
      // 현재 stocks 배열에 있는 데이터만 업데이트
      const existingTickers = new Set(stocks.map(stock => stock.ticker));
      
      updateStockPrices(existingTickers);
      lastUpdateRef.current = now;
      console.log("Stock prices updated");
    }
  }, [stocks, updateStockPrices]);

  // 컴포넌트 마운트 시 초기 현금 설정
  useEffect(() => {
    const initializeCash = async () => {
    const db = getDatabase();
    const userId = auth.currentUser.uid;
      const cashRef = ref(db, `users/${userId}/cash`);
      
      const snapshot = await get(cashRef);
      if (!snapshot.exists()) {
        await set(cashRef, {
          amount: 0, 
          weight: '0'
        });
      }
    };

    initializeCash();
  }, []);

  // 컴포넌트 마운트 시 기존 거래 데이터 마이그레이션
  useEffect(() => {
    const migrateTradeTypes = async () => {
      try {
        const db = getDatabase();
        const userId = auth.currentUser.uid;
        const stocksRef = ref(db, `users/${userId}/stocks`);
        const snapshot = await get(stocksRef);
        const stocks = snapshot.val();

        if (!stocks) return;

        // 각 주식의 거래내역 확인 및 업데이트
        for (const [ticker, stock] of Object.entries(stocks)) {
          if (!stock.trades) continue;

          const updatedTrades = stock.trades.map(trade => ({
            ...trade,
            type: trade.type || 'buy'  // type이 없는 거래는 매수로 처리
          }));

          // 변경사항이 있는 경우에만 업데이트
          if (JSON.stringify(updatedTrades) !== JSON.stringify(stock.trades)) {
            const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);
            await set(stockRef, {
              ...stock,
              trades: updatedTrades
            });
            console.log(`Migrated trade types for ${ticker}`);
          }
        }
      } catch (error) {
        console.error("Error migrating trade types:", error);
      }
    };

    migrateTradeTypes();
    // 기존 매도 거래에 avgBuyPrice 속성 추가
    updateSellTradesWithAvgBuyPrice();
  }, []); // 컴포넌트 마운트 시 한 번만 실행

  // 새 주식 추가
  const handleAddStock = async () => {
    if (!newStock.ticker || !newStock.sector || !newStock.category) {
      alert("모든 필드를 입력해주세요.");
      return;
    }

    try {
      const formattedTicker = /^\d+$/.test(newStock.ticker) 
        ? newStock.ticker  // 한국 주식
        : newStock.ticker.toUpperCase();  // 미국 주식

      let companyName = formattedTicker; // 기본값으로 ticker 사용

      // CSV 파일 경로 결정
      const csvPath = /^\d+$/.test(formattedTicker) 
        ? '/stock_list_kr.csv' 
        : '/stock_list_us.csv';

      try {
        const response = await fetch(csvPath);
        const csvText = await response.text();
        console.log('CSV content:', csvText); // 디버깅용

        const results = parse(csvText, { 
          header: true,
          skipEmptyLines: true
        });
        
        console.log('Parsed results:', results.data); // 디버깅용

        // 회사 찾기
        const company = results.data.find(row => {
          const rowCode = row.Code?.toString().trim();
          const searchTicker = formattedTicker.toString().trim();
          console.log('Comparing:', rowCode, searchTicker); // 디버깅용
          return rowCode === searchTicker;
        });

        if (company && company.Name) {
          companyName = company.Name.trim();
          console.log('Found company:', companyName); // 디버깅용
        } else {
          console.log('Company not found in CSV'); // 디버깅용
        }
      } catch (error) {
        console.error('Error loading company name:', error);
      }

      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${formattedTicker}`);

      const newStockData = {
        ...newStock,
        ticker: formattedTicker,
        companyName: companyName,
        avgPrice: 0,
        trades: []
      };

      console.log('Saving stock data:', newStockData); // 디버깅용

      await set(stockRef, newStockData);
      
      // 전체 비중 재계산
      await recalculateWeights();
      
      setShowAddModal(false);
      setNewStock({ ticker: '', sector: '', category: '', volatility: '선택' });
      
      console.log("Stock added successfully");
    } catch (error) {
      console.error("Error adding stock:", error);
      alert("주식 추가 중 오류가 발생했습니다.");
    }
  };

  // 주식 삭제
  const handleDeleteStock = async (ticker) => {
    if (!window.confirm(`${ticker} 주식을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);

      await set(stockRef, null);
      
      // 삭제 후 즉시 비중 재계산
      await recalculateWeights();
      
      console.log("Stock deleted successfully");
      onStocksUpdate();
    } catch (error) {
      console.error("Error deleting stock:", error);
      alert("주식 삭제 중 오류가 발생했습니다.");
    }
  };

  // 매수 거래 시 현금 잔액 확인 함수 추가
  const checkCashBalance = (trade, stock) => {
    // 매수 거래인 경우에만 확인
    if (trade.type !== 'buy') return true;
    
    const price = parseFloat(trade.price);
    const quantity = parseFloat(trade.quantity);
    const isUSStock = !/^\d+$/.test(stock.ticker);
    
    // 거래 금액 계산
    const tradeAmount = isUSStock ? price * quantity : price * quantity;
    
    // 현재 현금 잔액 확인
    const currentBalance = isUSStock ? parseFloat(cashUSD.amount) || 0 : parseFloat(cashKRW.amount) || 0;
    
    // 거래 금액이 현금 잔액보다 크면 false 반환
    return tradeAmount <= currentBalance;
  };

  // 매도 거래 시 보유 수량 확인 함수 추가
  const checkStockHolding = (trade, stock) => {
    // 매도 거래인 경우에만 확인
    if (trade.type !== 'sell') return true;
    
    const quantity = parseFloat(trade.quantity);
    
    // 현재 보유 수량 계산
    const trades = Array.isArray(stock.trades) ? [...stock.trades] : [];
    let currentQuantity = 0;
    
    trades.forEach(t => {
      if (t.type === 'buy') {
        currentQuantity += parseFloat(t.quantity);
      } else if (t.type === 'sell') {
        currentQuantity -= parseFloat(t.quantity);
      }
    });
    
    // 매도하려는 수량이 현재 보유 수량보다 크면 false 반환
    return quantity <= currentQuantity;
  };

  // 거래 추가 함수 수정
  const handleAddTrade = async () => {
    if (!selectedStock) return;
    
    // 입력값 검증
    if (!newTrade.date || !newTrade.price || !newTrade.quantity) {
      alert('날짜, 가격, 수량을 모두 입력해주세요.');
      return;
    }
    
    // 매수 거래인 경우 현금 잔액 확인
    if (newTrade.type === 'buy') {
      const hasEnoughCash = checkCashBalance(newTrade, selectedStock);
      if (!hasEnoughCash) {
        alert('현금 잔액이 부족합니다. 매수 거래를 입력할 수 없습니다.');
        return;
      }
    }
    
    // 매도 거래인 경우 보유 수량 확인
    if (newTrade.type === 'sell') {
      const hasEnoughStock = checkStockHolding(newTrade, selectedStock);
      if (!hasEnoughStock) {
        alert('보유 수량이 부족합니다. 매도 거래를 입력할 수 없습니다.');
        return;
      }
    }
    
    // 기존 거래 내역 복사
    const trades = Array.isArray(selectedStock.trades) ? [...selectedStock.trades] : [];
    
    // 새 거래 객체 생성
    const newTradeObj = {
      ...newTrade,
      price: parseFloat(newTrade.price),
      quantity: parseFloat(newTrade.quantity),
      id: Date.now().toString()
    };
    
    // 매도 거래인 경우 평균 매수가 계산하여 추가
    if (newTrade.type === 'sell') {
      // 매수 거래만 고려하여 평균매수가 계산
      const totalBuyCost = trades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + (parseFloat(t.price) * parseFloat(t.quantity));
        return sum;
      }, 0);

      const totalBuyQuantity = trades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        return sum;
      }, 0);

      const avgBuyPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
      newTradeObj.avgBuyPrice = avgBuyPrice;
    }
    
    trades.push(newTradeObj);
    
    // 주식 데이터 업데이트
    const updatedStock = {
      ...selectedStock,
      trades
    };
    
    try {
      // 데이터베이스 업데이트
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      await set(stockRef, updatedStock);
      
      // 현금 자산 업데이트 (매수/매도에 따라)
      await updateCashForTrade(newTradeObj, selectedStock);
      
      // 상태 업데이트
      onStocksUpdate();
      setShowTradeModal(false);
      setNewTrade({
        date: new Date().toISOString().split('T')[0],
        price: '',
        quantity: '',
        memo: '',
        type: 'buy'
      });
    } catch (error) {
      console.error('거래 추가 중 오류 발생:', error);
      alert('거래 추가 중 오류가 발생했습니다.');
    }
  };

  // 거래에 따른 현금 업데이트 함수
  const updateCashForTrade = async (trade, stock) => {
    const db = getDatabase();
    const userId = auth.currentUser.uid;
    
    const isUSStock = !/^\d+$/.test(stock.ticker);
    const tradeAmount = trade.price * trade.quantity;
    
    // 매수: 현금 감소, 매도: 현금 증가
    const amountChange = trade.type === 'buy' ? -tradeAmount : tradeAmount;
    
    if (isUSStock) {
      // 미국 주식: USD 현금 업데이트
      const newAmount = parseFloat(cashUSD.amount) + amountChange;
      const cashRef = ref(db, `users/${userId}/cash_usd`);
      await set(cashRef, {
        ...cashUSD,
        amount: newAmount,
        lastUpdated: new Date().toISOString()
      });
      
      // 현금 증감 내역 추가
      await addCashHistoryEntry({
        date: trade.date,
        amount: amountChange,
        currency: 'USD',
        type: trade.type === 'buy' ? 'stock_buy' : 'stock_sell',
        companyName: stock.companyName || stock.ticker,
        quantity: trade.quantity
      });
    } else {
      // 한국 주식: KRW 현금 업데이트
      const newAmount = parseFloat(cashKRW.amount) + amountChange;
      const cashRef = ref(db, `users/${userId}/cash_krw`);
      await set(cashRef, {
        ...cashKRW,
        amount: newAmount,
        lastUpdated: new Date().toISOString()
      });
      
      // 현금 증감 내역 추가
      await addCashHistoryEntry({
        date: trade.date,
        amount: amountChange,
        currency: 'KRW',
        type: trade.type === 'buy' ? 'stock_buy' : 'stock_sell',
        companyName: stock.companyName || stock.ticker,
        quantity: trade.quantity
      });
    }
    
    // 현금 정보 다시 로드
    await loadCashInfo();
  };

  // 거래내역 삭제 함수 수정 - 현재 보유 수량 정확히 계산 및 DB 반영
  const handleDeleteTrade = async (ticker, tradeId) => {
    if (!window.confirm("이 거래내역을 삭제하시겠습니까?")) {
      return;
    }

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);

      // 현재 주식 데이터 가져오기
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 선택된 거래내역 제외
      const updatedTrades = currentStock.trades.filter(trade => trade.id !== tradeId);

      // 현재 보유 수량 계산 (매수 - 매도)
      const currentQuantity = updatedTrades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        if (t.type === 'sell') return sum - parseFloat(t.quantity);
        return sum;
      }, 0);

      // 매수 거래만 고려하여 평균매수가 계산
      const totalBuyCost = updatedTrades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + (parseFloat(t.price) * parseFloat(t.quantity));
        return sum;
      }, 0);

      const totalBuyQuantity = updatedTrades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        return sum;
      }, 0);

      const avgPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;

      // 미국 주식 여부 확인
      const isUSStock = !/^\d+$/.test(ticker);
      
      // 현재 가격 가져오기
      const currentPrice = parseFloat(currentStock.currentPrice) || 0;
      
      // 손익 계산
      const profit = currentQuantity > 0 ? (currentPrice - avgPrice) * currentQuantity : 0;
      const profitRate = currentQuantity > 0 && avgPrice !== 0 ? 
        ((currentPrice - avgPrice) / avgPrice) * 100 : 0;
      
      // 원화 가치 계산
      const valueInKRW = isUSStock ? 
        (currentPrice * currentQuantity * usdToKrw) : 
        (currentPrice * currentQuantity);

      const updatedStock = {
        ...currentStock,
        avgPrice: avgPrice.toFixed(2),
        trades: updatedTrades,
        currentQuantity, // 현재 보유 수량 추가
        profit: profit.toFixed(2),
        profitRate: profitRate.toFixed(2),
        valueInKRW: valueInKRW.toFixed(0)
      };

      // Firebase에 업데이트된 데이터 저장
      await set(stockRef, updatedStock);

      // 전체 비중 재계산
      await recalculateWeights();

      // 선택된 주식 정보 업데이트 (거래내역 모달 테이블 갱신용)
      setSelectedStock(updatedStock);

      console.log("Trade deleted successfully");
      onStocksUpdate();
    } catch (error) {
      console.error("Error deleting trade:", error);
      alert("거래내역 삭제 중 오류가 발생했습니다.");
    }
  };

  // 거래내역 메모 수정 함수 수정 - 매개변수 문제 해결
  const handleEditTrade = async (ticker, tradeId) => {
    // 현재 거래 내역 중 해당 tradeId에 해당하는 항목을 찾음
    const currentTrade = selectedStock.trades.find(trade => trade.id === tradeId);
    if (!currentTrade) return;
    
    // 기존 메모를 기본값으로 하는 prompt 창을 띄워서 새 메모를 입력받음
    const newMemo = window.prompt("새로운 메모를 입력하세요:", currentTrade.memo || "");
    if (newMemo === null) return; // 취소한 경우 아무 작업도 하지 않음

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);
      
      // 현재 주식 데이터를 가져옴
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 거래 내역 배열에서 해당 tradeId를 업데이트
      const updatedTrades = currentStock.trades.map(trade => {
        if (trade.id === tradeId) {
          return { ...trade, memo: newMemo };
        }
        return trade;
      });

      const updatedStock = {
        ...currentStock,
        trades: updatedTrades
      };

      // Firebase에 업데이트된 데이터 저장
      await set(stockRef, updatedStock);

      // 선택된 주식 정보 업데이트 (모달 갱신)
      setSelectedStock(updatedStock);

      console.log("Trade memo updated successfully");
    } catch (error) {
      console.error("Error updating trade memo:", error);
    }
  };

  // 섹터/카테고리 수정 함수 추가
  const handleEditField = async (ticker, field, value) => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);
      
      // 현재 주식 데이터 가져오기
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 필드 업데이트
      const updatedStock = {
        ...currentStock,
        [field]: value
      };

      // Firebase에 업데이트된 데이터 저장
      await set(stockRef, updatedStock);
      
      // 편집 모드 종료
      setEditingCell({ ticker: null, field: null });
      setEditValue('');

      console.log(`${field} updated successfully`);
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      alert(`${field} 수정 중 오류가 발생했습니다.`);
    }
  };

  // 키보드 이벤트 핸들러 추가
  const handleKeyDown = (e, ticker, field) => {
    if (e.key === 'Enter') {
      handleEditField(ticker, field, editValue);
    } else if (e.key === 'Escape') {
      setEditingCell({ ticker: null, field: null });
      setEditValue('');
    }
  };

  // 컴포넌트 마운트 시와 주기적으로 현재가 업데이트
  useEffect(() => {
    let isMounted = true;
    const timeoutRef = updateTimeoutRef.current;

    const updateIfMounted = () => {
      if (isMounted) {
        debouncedUpdateStockPrices();
      }
    };

    // 초기 업데이트
    updateIfMounted();

    // 5분마다 업데이트
    const interval = setInterval(updateIfMounted, 60000);

    return () => {
      isMounted = false;
      clearInterval(interval);
      if (timeoutRef) {
        clearTimeout(timeoutRef);
      }
    };
  }, [debouncedUpdateStockPrices]);

  // 네이버 금융 URL 생성 함수
  const getNaverFinanceUrl = (ticker) => {
    // 미국 주식인 경우 네이버 금융에서 조회 불가
    if (!/^\d+$/.test(ticker)) {
      return null;
    }
    return `https://navercomp.wisereport.co.kr/v2/company/c1010001.aspx?cn=&cmp_cd=${ticker}`;
  };

  // 거래내역 수정 모달 열기
  const handleOpenEditTradeModal = (trade) => {
    setEditingTrade(trade);
    setEditTradeForm({
      price: trade.price,
      quantity: trade.quantity,
      type: trade.type
    });
    setShowEditTradeModal(true);
  };

  // 거래내역 수정 저장
  const handleSaveTradeEdit = async () => {
    try {
      // 매도로 변경 시 보유 수량 체크
      if (editTradeForm.type === 'sell') {
        const currentQuantity = selectedStock.trades.reduce((sum, t) => {
          if (t.id === editingTrade.id) return sum; // 현재 수정 중인 거래는 제외
          if (t.type === 'buy') return sum + parseFloat(t.quantity);
          if (t.type === 'sell') return sum - parseFloat(t.quantity);
          return sum;
        }, 0);
        
        if (parseFloat(editTradeForm.quantity) > currentQuantity) {
          alert(`매도 가능 수량(${currentQuantity}주)을 초과합니다.`);
          return;
        }
      }

      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 거래 내역 배열에서 수정할 거래 업데이트
      const updatedTrades = currentStock.trades.map(trade => {
        if (trade.id === editingTrade.id) {
          const updatedTrade = { 
            ...trade, 
            price: parseFloat(editTradeForm.price),
            quantity: parseFloat(editTradeForm.quantity),
            type: editTradeForm.type
          };
          
          // 매도 거래인 경우 평균 매수가 계산하여 추가
          if (updatedTrade.type === 'sell') {
            // 현재 수정 중인 거래를 제외한 매수 거래만 고려하여 평균매수가 계산
            const otherTrades = currentStock.trades.filter(t => t.id !== editingTrade.id);
            const totalBuyCost = otherTrades.reduce((sum, t) => {
              if (t.type === 'buy') return sum + (parseFloat(t.price) * parseFloat(t.quantity));
              return sum;
            }, 0);

            const totalBuyQuantity = otherTrades.reduce((sum, t) => {
              if (t.type === 'buy') return sum + parseFloat(t.quantity);
              return sum;
            }, 0);

            const avgBuyPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
            updatedTrade.avgBuyPrice = avgBuyPrice;
          }
          
          return updatedTrade;
        }
        return trade;
      });

      // 현재 보유 수량 계산 (매수 - 매도)
      const currentQuantity = updatedTrades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        if (t.type === 'sell') return sum - parseFloat(t.quantity);
        return sum;
      }, 0);

      // 매수 거래만 고려하여 평균매수가 계산
      const totalBuyCost = updatedTrades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + (parseFloat(t.price) * parseFloat(t.quantity));
        return sum;
      }, 0);

      const totalBuyQuantity = updatedTrades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        return sum;
      }, 0);

      const avgPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;

      // 손익 재계산
      const currentPrice = parseFloat(currentStock.currentPrice);
      const profit = currentQuantity > 0 ? (currentPrice - avgPrice) * currentQuantity : 0;
      const profitRate = currentQuantity > 0 && avgPrice !== 0 ? 
        ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

      // 원화 가치 재계산
      const isUSStock = !/^\d+$/.test(selectedStock.ticker);
      const usdToKrw = 1450;
      const valueInKRW = isUSStock ? 
        (currentPrice * currentQuantity * usdToKrw) : 
        (currentPrice * currentQuantity);

      const updatedStock = {
        ...currentStock,
        trades: updatedTrades,
        avgPrice: avgPrice.toFixed(2),
        profit: profit.toFixed(2),
        profitRate: profitRate.toFixed(2),
        valueInKRW: valueInKRW.toFixed(0)
      };

      // Firebase에 업데이트된 데이터 저장
      await set(stockRef, updatedStock);

      // 전체 비중 재계산
      await recalculateWeights();

      // 선택된 주식 정보 업데이트
      setSelectedStock(updatedStock);

      // 모달 닫기
      setShowEditTradeModal(false);
      setEditingTrade(null);
      setEditTradeForm({ price: '', quantity: '', type: 'buy' });

    } catch (error) {
      console.error("Error updating trade:", error);
      alert("거래내역 수정 중 오류가 발생했습니다.");
    }
  };

  // 현금 정보 로드 함수 추가
  const loadCashInfo = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const db = getDatabase();
      const cashKRWRef = ref(db, `users/${user.uid}/cash_krw`);
      const cashUSDRef = ref(db, `users/${user.uid}/cash_usd`);

      // 원화 현금 정보 로드
      const cashKRWSnapshot = await get(cashKRWRef);
      if (cashKRWSnapshot.exists()) {
        const cashKRWData = cashKRWSnapshot.val();
        setCashKRW(cashKRWData);
        // 기존 cashAmount 호환성 유지
        setCashAmount(parseFloat(cashKRWData.amount) || 0);
        if (onCashUpdate) {
          onCashUpdate(parseFloat(cashKRWData.amount) || 0);
        }
      }

      // 달러 현금 정보 로드
      const cashUSDSnapshot = await get(cashUSDRef);
      if (cashUSDSnapshot.exists()) {
        const cashUSDData = cashUSDSnapshot.val();
        setCashUSD(cashUSDData);
      }
    } catch (error) {
      console.error("Error loading cash info:", error);
    }
  }, [onCashUpdate]);

  // 컴포넌트 마운트 시 현금 정보 로드
  useEffect(() => {
    loadCashInfo();
  }, [loadCashInfo]);

  // 현금 내역 관련 state 추가
  const [cashHistory, setCashHistory] = useState([]);

  // 현금 내역 가져오기 함수 수정 - 잔액 계산 추가
  const fetchCashHistory = useCallback(async () => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      
      // 현금 입출금 내역 가져오기
      const cashHistoryRef = ref(db, `users/${userId}/cash_history`);
      const cashHistorySnapshot = await get(cashHistoryRef);
      const cashHistoryData = cashHistorySnapshot.exists() ? cashHistorySnapshot.val() : [];
      
      // 주식 거래 내역 가져오기
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const stocksSnapshot = await get(stocksRef);
      const stocksData = stocksSnapshot.exists() ? stocksSnapshot.val() : {};
      
      // 주식 거래로 인한 현금 변동 내역 추출
      const tradeHistory = [];
      
      Object.entries(stocksData).forEach(([ticker, stock]) => {
        if (stock && Array.isArray(stock.trades)) {
          stock.trades.forEach(trade => {
            const isUSStock = !/^\d+$/.test(ticker);
            const currency = isUSStock ? 'USD' : 'KRW';
            const amount = parseFloat(trade.price) * parseFloat(trade.quantity);
            
            tradeHistory.push({
              date: trade.date,
              type: trade.type === 'buy' ? 'stock_buy' : 'stock_sell',
              amount: trade.type === 'buy' ? -amount : amount,
              currency,
              ticker,
              companyName: stock.companyName || ticker, // 회사 이름 추가
              price: parseFloat(trade.price),
              quantity: parseFloat(trade.quantity),
              description: `${stock.companyName || ticker} ${trade.type === 'buy' ? '매수' : '매도'}`
            });
          });
        }
      });
      
      // 모든 내역 합치기
      const allHistory = [
        ...tradeHistory,
        ...Object.values(cashHistoryData).map(item => ({
          ...item,
          date: item.date || new Date().toISOString().split('T')[0]
        }))
      ];
      
      // 날짜순으로 정렬 (오래된 순)
      allHistory.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      // 통화별 잔액 계산
      let balanceKRW = 0;
      let balanceUSD = 0;
      
      // 각 항목에 잔액 추가
      const historyWithBalance = allHistory.map(item => {
        if (item.currency === 'USD') {
          balanceUSD += parseFloat(item.amount);
          return { ...item, balance: balanceUSD };
        } else {
          balanceKRW += parseFloat(item.amount);
          return { ...item, balance: balanceKRW };
        }
      });
      
      // 최신 순으로 다시 정렬
      historyWithBalance.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      // 월별로 그룹화
      const groupedByMonth = historyWithBalance.reduce((acc, item) => {
        const month = item.date.substring(0, 7); // YYYY-MM 형식
        if (!acc[month]) {
          acc[month] = [];
        }
        acc[month].push(item);
        return acc;
      }, {});
      
      setCashHistory(groupedByMonth);
      
      // 현재 달을 기본값으로 설정
      const currentMonth = new Date().toISOString().substring(0, 7);
      
      // 내역이 있는 달 중 가장 최근 달 찾기
      const availableMonths = Object.keys(groupedByMonth).sort().reverse();
      
      if (availableMonths.length > 0) {
        // 현재 달에 내역이 있으면 현재 달 선택, 없으면 가장 최근 달 선택
        if (groupedByMonth[currentMonth]) {
          setSelectedMonth(currentMonth);
        } else {
          setSelectedMonth(availableMonths[0]);
        }
      } else {
        setSelectedMonth(currentMonth); // 내역이 없어도 현재 달 표시
      }
    } catch (error) {
      console.error("Error fetching cash history:", error);
    }
  }, []);

  // 현금 모달이 열릴 때 내역 가져오기
  useEffect(() => {
    if (showCashModal) {
      fetchCashHistory();
    }
  }, [showCashModal, fetchCashHistory]);

  // 현금 업데이트 함수 수정 - 내역 저장 추가
  const handleCashUpdate = async () => {
    try {
      if (!cashForm.amount) {
        alert("금액을 입력해주세요.");
        return;
      }
      
      const amount = parseFloat(cashForm.amount);
      if (isNaN(amount)) {
        alert("유효한 금액을 입력해주세요.");
        return;
      }
      
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      
      // 통화에 따른 현금 참조 결정
      const cashRefPath = cashForm.currency === 'USD' ? 'cash_usd' : 'cash_krw';
      const cashRef = ref(db, `users/${userId}/${cashRefPath}`);
      
      // 현재 현금 정보 가져오기
      const snapshot = await get(cashRef);
      const currentCash = snapshot.exists() ? snapshot.val() : {
        amount: 0,
        category: '현금',
        currency: cashForm.currency,
        lastUpdated: new Date().toISOString(),
        valueInKRW: '0',
        volatility: '안정적',
        weight: '0.00'
      };
      
      // 새 금액 계산
      const newAmount = parseFloat(currentCash.amount) + amount;
      
      // 원화 가치 계산
      const valueInKRW = cashForm.currency === 'USD' ? 
        newAmount * usdToKrw : 
        newAmount;
      
      // 현금 정보 업데이트
      await set(cashRef, {
        ...currentCash,
        amount: newAmount.toString(),
        lastUpdated: new Date().toISOString(),
        valueInKRW: valueInKRW.toString()
      });
      
      // 현금 내역 저장
      const historyRef = ref(db, `users/${userId}/cash_history/${Date.now()}`);
      await set(historyRef, {
        date: cashForm.date, // 사용자가 지정한 날짜 사용
        amount,
        currency: cashForm.currency,
        type: amount > 0 ? 'deposit' : 'withdraw',
        description: cashForm.description || (amount > 0 ? '입금' : '출금')
      });
      
      // 상태 업데이트
      if (cashForm.currency === 'USD') {
        setCashUSD({
          ...cashUSD,
          amount: newAmount,
          valueInKRW: valueInKRW.toString()
        });
      } else {
        setCashKRW({
          ...cashKRW,
          amount: newAmount,
          valueInKRW: valueInKRW.toString()
        });
      }
      
      // 전체 비중 재계산
      await recalculateWeights();
      
      // 모달 닫기 및 폼 초기화
      setShowCashModal(false);
      setCashForm({
        amount: '',
        description: '',
        currency: 'KRW',
        date: new Date().toISOString().split('T')[0] // 오늘 날짜로 초기화
      });
      
      // 현금 내역 다시 가져오기
      fetchCashHistory();
      
      console.log("Cash updated successfully");
    } catch (error) {
      console.error("Error updating cash:", error);
      alert("현금 업데이트 중 오류가 발생했습니다.");
    }
  };

  // 메모 관련 함수들 추가
  const loadMemos = useCallback(async () => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const memosRef = ref(db, `users/${userId}/memos`);
      const snapshot = await get(memosRef);
      if (snapshot.exists()) {
        const memosData = Object.values(snapshot.val());
        setMemos(memosData.sort((a, b) => new Date(b.date) - new Date(a.date)));
      } else {
        setMemos([]); // snapshot이 없을 때 빈 배열로 초기화
      }
    } catch (error) {
      console.error("Error loading memos:", error);
      setMemos([]); // 에러 발생 시에도 빈 배열로 초기화
    }
  }, []);

  const handleAddMemo = async () => {
    if (!newMemo.content) {
      alert("메모 내용을 입력해주세요.");
      return;
    }

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      // memosRef 변수 제거하고 직접 경로 사용
      const newMemoWithId = {
        ...newMemo,
        id: Date.now(),
        createdAt: new Date().toISOString()
      };

      await set(ref(db, `users/${userId}/memos/${newMemoWithId.id}`), newMemoWithId);
      setNewMemo({ content: '', date: new Date().toISOString().split('T')[0] });
      await loadMemos();
    } catch (error) {
      console.error("Error adding memo:", error);
      alert("메모 추가 중 오류가 발생했습니다.");
    }
  };

  const handleDeleteMemo = async (memoId) => {
    if (!window.confirm("이 메모를 삭제하시겠습니까?")) return;
    
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      await set(ref(db, `users/${userId}/memos/${memoId}`), null);
      
      // 메모 삭제 후 즉시 상태 업데이트
      setMemos(prevMemos => prevMemos.filter(memo => memo.id !== memoId));
      
      // DB 재로딩
      await loadMemos();
    } catch (error) {
      console.error("Error deleting memo:", error);
      alert("메모 삭제 중 오류가 발생했습니다.");
    }
  };

  // 메모 수정 함수 추가
  const handleEditMemo = async (memo) => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      
      await set(ref(db, `users/${userId}/memos/${memo.id}`), {
        ...memo,
        updatedAt: new Date().toISOString()
      });
      
      setEditingMemo(null);
      await loadMemos();
    } catch (error) {
      console.error("Error updating memo:", error);
      alert("메모 수정 중 오류가 발생했습니다.");
    }
  };

  // useEffect 추가 (다른 useEffect 근처에)
  useEffect(() => {
    loadMemos();
  }, [loadMemos]);


  // 현금 증감 내역 추가 함수
  const addCashHistoryEntry = async (entry) => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      
      // 날짜에서 연월 추출 (YYYY-MM 형식)
      const month = entry.date.substring(0, 7);
      
      // 해당 월의 현금 내역 참조
      const cashHistoryRef = ref(db, `users/${userId}/cashHistory/${month}`);
      
      // 현재 내역 가져오기
      const snapshot = await get(cashHistoryRef);
      const currentHistory = snapshot.exists() ? snapshot.val() : [];
      
      // 새 내역 추가
      const updatedHistory = [...currentHistory, entry];
      
      // 데이터베이스에 저장
      await set(cashHistoryRef, updatedHistory);
      
      // 현금 내역 다시 로드
      loadCashHistory();
    } catch (error) {
      console.error('현금 내역 추가 중 오류 발생:', error);
    }
  };

  // 현금 내역 로드 함수 수정
  const loadCashHistory = useCallback(async () => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const cashHistoryRef = ref(db, `users/${userId}/cashHistory`);
      
      const snapshot = await get(cashHistoryRef);
      if (snapshot.exists()) {
        const history = snapshot.val();
        setCashHistory(history);
        
        // 가장 최근 월을 선택 (selectedMonth가 없거나 선택된 월이 내역에 없는 경우에만)
        const months = Object.keys(history).sort().reverse();
        if (months.length > 0 && (!selectedMonth || !history[selectedMonth])) {
          setSelectedMonth(months[0]);
        }
      } else {
        setCashHistory({});
      }
    } catch (error) {
      console.error('현금 내역 로드 중 오류 발생:', error);
    }
  }, [selectedMonth]);

  // 월 선택 변경 핸들러 추가
  const handleMonthChange = (e) => {
    setSelectedMonth(e.target.value);
  };



  // 현금 모달 열기 버튼 클릭 핸들러 수정
  const handleCashButtonClick = () => {
    setCashForm(prev => ({ ...prev, currency: 'KRW' }));
    setShowCashModal(true);
    loadCashHistory();
  };

  // 기존 매도 거래에 avgBuyPrice 속성 추가하는 함수
  const updateSellTradesWithAvgBuyPrice = async () => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      
      // 모든 주식 데이터 가져오기
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const snapshot = await get(stocksRef);
      const allStocks = snapshot.val() || {};
      
      let updatedCount = 0;
      
      // 각 주식에 대해 처리
      for (const ticker in allStocks) {
        const stock = allStocks[ticker];
        if (!Array.isArray(stock.trades) || stock.trades.length === 0) continue;
        
        let needsUpdate = false;
        const updatedTrades = [...stock.trades];
        
        // 거래 내역을 날짜순으로 정렬
        updatedTrades.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // 각 시점의 평균 매수가 계산
        let currentQuantity = 0;
        let totalInvestment = 0;
        
        for (let i = 0; i < updatedTrades.length; i++) {
          const trade = updatedTrades[i];
          
          if (trade.type === 'buy') {
            // 매수: 수량과 투자원금 증가
            currentQuantity += parseFloat(trade.quantity);
            totalInvestment += parseFloat(trade.price) * parseFloat(trade.quantity);
          } else if (trade.type === 'sell') {
            // 매도 거래에 avgBuyPrice 속성이 없으면 추가
            if (trade.avgBuyPrice === undefined) {
              const avgBuyPrice = currentQuantity > 0 ? totalInvestment / currentQuantity : 0;
              updatedTrades[i] = {
                ...trade,
                avgBuyPrice: avgBuyPrice
              };
              needsUpdate = true;
            }
            
            // 매도: 수량과 투자원금 감소 (평균매수가 기준)
            const avgPrice = currentQuantity > 0 ? totalInvestment / currentQuantity : 0;
            const sellAmount = parseFloat(trade.quantity) * avgPrice;
            
            currentQuantity -= parseFloat(trade.quantity);
            totalInvestment = currentQuantity > 0 ? totalInvestment - sellAmount : 0;
          }
        }
        
        // 변경된 내용이 있으면 DB 업데이트
        if (needsUpdate) {
          const stockRef = ref(db, `users/${userId}/stocks/${ticker}`);
          await set(stockRef, {
            ...stock,
            trades: updatedTrades
          });
          updatedCount++;
        }
      }
      
      if (updatedCount > 0) {
        console.log(`${updatedCount}개 종목의 매도 거래 정보가 업데이트되었습니다.`);
      }
    } catch (error) {
      console.error("매도 거래 정보 업데이트 중 오류 발생:", error);
    }
  };

  return (
    <div className="stock-table-container">
      <div className="table-header">
        <h2>주식 포트폴리오</h2>
        <div className="table-buttons">
          <button 
            className="btn btn-primary me-2"
            onClick={() => setShowAddModal(true)}
          >
            <i className="fas fa-plus"></i> 주식 추가
          </button>
          <button 
            className="btn btn-info text-white"
            onClick={() => setShowMemoModal(true)}
          >
            <i className="fas fa-sticky-note"></i> 메모
          </button>
        </div>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>종목코드</th>
            <th>회사이름</th>
            <th onClick={() => requestSort('sector')} style={{cursor: 'pointer'}}>
              섹터 {getSortDirectionIcon('sector')}
            </th>
            <th onClick={() => requestSort('category')} style={{cursor: 'pointer'}}>
              카테고리 {getSortDirectionIcon('category')}
            </th>
            <th onClick={() => requestSort('volatility')} style={{cursor: 'pointer'}}>
              변동성 {getSortDirectionIcon('volatility')}
            </th>
            <th onClick={() => requestSort('totalInvestment')} style={{cursor: 'pointer'}}>
              투자원금 {getSortDirectionIcon('totalInvestment')}
            </th>
            <th onClick={() => requestSort('avgPrice')} style={{cursor: 'pointer'}}>
              평균매수가격 {getSortDirectionIcon('avgPrice')}
            </th>
            <th onClick={() => requestSort('currentPrice')} style={{cursor: 'pointer'}}>
              현재가격 {getSortDirectionIcon('currentPrice')}
            </th>
            <th onClick={() => requestSort('evaluationValue')} style={{cursor: 'pointer'}}>
              평가금액(평가수익) {getSortDirectionIcon('evaluationValue')}
            </th>
            <th onClick={() => requestSort('profitRate')} style={{cursor: 'pointer'}}>
              수익률 {getSortDirectionIcon('profitRate')}
            </th>
            <th onClick={() => requestSort('weight')} style={{cursor: 'pointer'}}>
              비중 {getSortDirectionIcon('weight')}
            </th>
            <th>상세</th>
            <th>기업정보</th>
            <th>삭제</th>
          </tr>
        </thead>
        <tbody>
          {getSortedStocks(stocks).map((stock) => {
            // 거래 내역 정렬 (날짜순)
            const trades = Array.isArray(stock.trades) ? [...stock.trades] : [];
            trades.sort((a, b) => new Date(a.date) - new Date(b.date));
            
            // eslint-disable-next-line no-unused-vars
            const isUSStock = !/^\d+$/.test(stock.ticker);
            
            // 시간순으로 거래를 처리하며 현재 보유 수량과 투자원금 계산
            // 정렬 함수에서 이미 계산된 값 사용
            const currentQuantity = stock._currentQuantity || 0;
            const totalInvestment = stock._totalInvestment || 0;
            
            // 평균 매수가 계산 (정수로 반올림)
            const avgPrice = currentQuantity > 0 ? Math.round(totalInvestment / currentQuantity) : 0;
            
            // 평가금액 계산
            const evaluationValue = parseFloat(stock.valueInKRW || 0);
            
            // 수익률 계산
            const profitRate = totalInvestment > 0 ? ((evaluationValue - totalInvestment) / totalInvestment) * 100 : 0;
            
            // 보유 여부에 따라 행 스타일 설정
            const rowStyle = currentQuantity <= 0 ? { backgroundColor: '#f8f9fa' } : {};

            return (
              <tr key={stock.ticker} style={rowStyle}>
                <td>{stock.ticker}</td>
                <td>{stock.companyName}</td>
                <td 
                  onDoubleClick={() => {
                    setEditingCell({ ticker: stock.ticker, field: 'sector' });
                    setEditValue(stock.sector);
                  }}
                >
                  {editingCell.ticker === stock.ticker && editingCell.field === 'sector' ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleEditField(stock.ticker, 'sector', editValue)}
                      onKeyDown={(e) => handleKeyDown(e, stock.ticker, 'sector')}
                      autoFocus
                    />
                  ) : (
                    stock.sector
                  )}
                </td>
                <td 
                  onDoubleClick={() => {
                    setEditingCell({ ticker: stock.ticker, field: 'category' });
                    setEditValue(stock.category);
                  }}
                >
                  {editingCell.ticker === stock.ticker && editingCell.field === 'category' ? (
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleEditField(stock.ticker, 'category', editValue)}
                      onKeyDown={(e) => handleKeyDown(e, stock.ticker, 'category')}
                      autoFocus
                    />
                  ) : (
                    stock.category
                  )}
                </td>
                <td>
                  <select
                    value={stock.volatility || '선택'}
                    onChange={(e) => handleEditField(stock.ticker, 'volatility', e.target.value)}
                    className="form-select form-select-sm"
                  >
                    {VOLATILITY_OPTIONS.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </td>
                <td>{totalInvestment > 0 ? Math.round(totalInvestment).toLocaleString() : ' '}</td>
                <td>{currentQuantity > 0 ? Math.round(avgPrice).toLocaleString() : ' '}</td>
                <td>{parseFloat(stock.currentPrice).toLocaleString()}</td>
                <td style={{ color: profitRate > 0 ? 'red' : profitRate < 0 ? 'blue' : 'black' }}>
                  {currentQuantity > 0 ? `${Math.round(evaluationValue).toLocaleString()}원` : ' '}
                  <br />
                  {currentQuantity > 0 && totalInvestment > 0 ? `(${profitRate > 0 ? '+' : ''}${Math.round(evaluationValue - totalInvestment).toLocaleString()})` : ''}
                </td>
                <td style={{ color: profitRate > 0 ? 'red' : profitRate < 0 ? 'blue' : 'black' }}>
                  {currentQuantity > 0 && totalInvestment > 0 ? `${profitRate > 0 ? '+' : ''}${profitRate.toFixed(2)}%` : ' '}
                </td>
                <td>{parseFloat(stock.weight).toFixed(2)}%</td>
                <td>
                  <button 
                    className="btn btn-info btn-sm me-2"
                    onClick={() => {
                      setSelectedStock(stock);
                      setShowChart(true);
                    }}
                  >
                    차트
                  </button>
                  <button 
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setSelectedStock(stock);
                      setShowTradeModal(true);
                    }}
                  >
                    거래내역
                  </button>
                </td>
                <td>
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setSelectedStock(stock);
                      setShowCompanyInfo(true);
                    }}
                    disabled={!/^\d+$/.test(stock.ticker)}
                  >
                    기업정보
                  </button>
                </td>
                <td>
                  <button 
                    className="btn btn-danger"
                    onClick={() => handleDeleteStock(stock.ticker)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            );
          })}
          
          {/* 총계 행 수정 */}
          <tr className="total-row" style={{ fontWeight: 'bold', backgroundColor: '#f8f9fa' }}>
            <td>총계</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>{Math.round(totals.totalInvestment).toLocaleString()}</td>
            <td></td>
            <td></td>
            <td style={{ color: totals.totalEvaluation > totals.totalInvestment ? 'red' : 'blue' }}>
              {Math.round(totals.totalEvaluation).toLocaleString()}원
              <br />
              ({(totals.totalEvaluation > totals.totalInvestment ? '+' : '')}
              {Math.round(totals.totalEvaluation - totals.totalInvestment).toLocaleString()})
            </td>
            <td style={{ color: totals.totalEvaluation > totals.totalInvestment ? 'red' : 'blue' }}>
              {(totals.totalEvaluation > totals.totalInvestment ? '+' : '')}
              {((totals.totalEvaluation - totals.totalInvestment) / totals.totalInvestment * 100).toFixed(2)}%
            </td>
            <td></td>
            <td colSpan="3"></td>
          </tr>

          {/* 현금 행 - 원화 */}
          <tr className="cash_krw-row" style={{ fontWeight: 'bold', backgroundColor: '#f8f9fa' }}>
            <td>현금자산(원화)</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>{Math.round(parseFloat(cashKRW.amount) || 0).toLocaleString()}</td>
            <td></td>
            <td></td>
            <td>{Math.round(parseFloat(cashKRW.amount) || 0).toLocaleString()}원</td>
            <td></td>
            <td>{parseFloat(cashKRW.weight || 0).toFixed(2)}%</td>
            <td colSpan="3">
              <button 
                className="btn btn-outline-primary me-2" 
                onClick={handleCashButtonClick} // 직접 setShowCashModal(true) 대신 handleCashButtonClick 함수 호출
              >
                현금 관리
              </button>
            </td>
          </tr>

          {/* 현금 행 - 달러 */}
          <tr className="cash_usd-row" style={{ fontWeight: 'bold', backgroundColor: '#f8f9fa' }}>
            <td>현금자산(달러)</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>${Math.round(parseFloat(cashUSD.amount) || 0).toLocaleString()}</td>
            <td></td>
            <td></td>
            <td>{Math.round(parseFloat(cashUSD.valueInKRW) || 0).toLocaleString()}원</td>
            <td></td>
            <td>{parseFloat(cashUSD.weight || 0).toFixed(2)}%</td>
            <td colSpan="3"></td>
          </tr>

          {/* 전체 합계 행 (투자원금 + 현금자산) - 배경색만 변경 */}
          <tr className="grand-total-row" style={{ fontWeight: 'bold', backgroundColor: '#cfe2ff', borderTop: '2px solid #dee2e6' }}>
            <td>전체 합계</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>{Math.round(totals.totalInvestment + parseFloat(cashKRW.amount || 0) + parseFloat(cashUSD.valueInKRW || 0)).toLocaleString()}</td>
            <td></td>
            <td></td>
            <td>{Math.round(totals.totalEvaluation + parseFloat(cashKRW.amount || 0) + parseFloat(cashUSD.valueInKRW || 0)).toLocaleString()}원</td>
            <td></td>
            <td>100.00%</td>
            <td colSpan="3"></td>
          </tr>
        </tbody>
      </table>

      {/* 주식 추가 모달 */}
      {showAddModal && (
        <div className="modal">
          <div className="modal-content">
            <h3>새 주식 추가</h3>
            <input
              type="text"
              placeholder="Ticker"
              value={newStock.ticker}
              onChange={(e) => setNewStock({...newStock, ticker: e.target.value.toUpperCase()})}
            />
            <input
              type="text"
              placeholder="섹터"
              value={newStock.sector}
              onChange={(e) => setNewStock({...newStock, sector: e.target.value})}
            />
            <input
              type="text"
              placeholder="카테고리"
              value={newStock.category}
              onChange={(e) => setNewStock({...newStock, category: e.target.value})}
            />
            <select
              value={newStock.volatility}
              onChange={(e) => setNewStock({...newStock, volatility: e.target.value})}
              className="form-select"
            >
              {VOLATILITY_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
            <div className="modal-buttons">
              <button onClick={handleAddStock}>새 주식 추가</button>
              <button onClick={() => {
                setShowAddModal(false);
                setNewStock({ ticker: '', sector: '', category: '', volatility: '선택' });
              }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {/* 거래내역 모달 */}
      {showTradeModal && selectedStock && (
        <div className="modal trade-modal" style={{display: 'block', backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{selectedStock.companyName} ({selectedStock.ticker}) 거래내역</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => {
                    setShowTradeModal(false);
                    setSelectedStock(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="trade-list">
                  <table className="trade-table">
                    <thead>
                      <tr>
                        <th style={{ width: '150px' }}>날짜</th>
                        <th>거래유형</th>
                        <th>거래가격</th>
                        <th>수량</th>
                        <th>현재가격</th>
                        <th>손익</th>
                        <th>수익률</th>
                        <th>메모</th>
                        <th>수정</th>
                        <th>삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(selectedStock.trades) ? selectedStock.trades.map((trade) => (
                        <tr key={trade.id}>
                          <td>{trade.date}</td>
                          <td style={{ color: trade.type === 'sell' ? 'blue' : 'red' }}>
                            {trade.type === 'sell' ? '매도' : '매수'}
                          </td>
                          <td>{Number(trade.price).toLocaleString()}</td>
                          <td>{trade.quantity}</td>
                          <td>{Number(selectedStock.currentPrice).toLocaleString()}</td>
                          <td>
                            {trade.type === 'sell' 
                              ? `실현손익: ${Number(((trade.price - (trade.avgBuyPrice || 0)) * trade.quantity) || 0).toLocaleString()}`
                              : Number((selectedStock.currentPrice - trade.price) * trade.quantity).toLocaleString()
                            }
                          </td>
                          <td>
                            {trade.type === 'sell'
                              ? `${(((trade.price - (trade.avgBuyPrice || 0)) / (trade.avgBuyPrice || 1) * 100) || 0).toFixed(2)}%`
                              : `${((selectedStock.currentPrice - trade.price) / trade.price * 100).toFixed(2)}%`
                          }
                          </td>
                          <td>{trade.memo}</td>
                          <td>
                            <button 
                              onClick={() => handleOpenEditTradeModal(trade)}
                              className="btn btn-primary btn-sm me-2"
                            >
                              수정
                            </button>
                            <button 
                              onClick={() => handleEditTrade(selectedStock.ticker, trade.id)}
                              className="btn btn-warning btn-sm me-2"
                            >
                              메모수정
                            </button>
                          </td>
                          <td>
                            <button 
                              onClick={() => handleDeleteTrade(selectedStock.ticker, trade.id)}
                              className="btn btn-danger"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      )) : null}
                    </tbody>
                  </table>
                </div>

                {/* 거래내역 추가 폼 */}
                <div className="trade-form">
                  <input
                    type="date"
                    value={newTrade.date}
                    style={{ width: '120px' }}
                    onChange={(e) => setNewTrade({...newTrade, date: e.target.value})}
                  />
                  <select
                    value={newTrade.type}
                    onChange={(e) => setNewTrade({...newTrade, type: e.target.value})}
                    className="form-select form-select-sm"
                    style={{ width: '100px' }}
                  >
                    <option value="buy">매수</option>
                    <option value="sell">매도</option>
                  </select>
                  <input
                    type="number"
                    placeholder="가격"
                    value={newTrade.price}
                    onChange={(e) => setNewTrade({...newTrade, price: e.target.value})}
                  />
                  <input
                    type="number"
                    placeholder="수량"
                    value={newTrade.quantity}
                    onChange={(e) => setNewTrade({...newTrade, quantity: e.target.value})}
                  />
                  <input
                    type="text"
                    placeholder="메모"
                    value={newTrade.memo}
                    onChange={(e) => setNewTrade({...newTrade, memo: e.target.value})}
                  />
                  <button onClick={handleAddTrade}>추가</button>
                </div>

                <div className="modal-buttons">
                  <button onClick={() => {
                    setShowTradeModal(false);
                    setSelectedStock(null);
                  }}>닫기</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 차트 모달 */}
      {showChart && selectedStock && (
        <div className="modal chart-modal" style={{display: 'block', backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"> {selectedStock?.companyName}</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => setShowChart(false)}
                ></button>
              </div>
              <div className="modal-body">
                <StockChart 
                  stock={selectedStock} 
                  trades={selectedStock?.trades || []} 
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 기업정보 모달 추가 */}
      {showCompanyInfo && selectedStock && (
        <div className="modal" style={{display: 'block', backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog modal-xl" style={{ maxWidth: '90%', height: '90vh' }}>
            <div className="modal-content" style={{ height: '100%' }}>
              <div className="modal-header">
                <h5 className="modal-title">{selectedStock?.companyName} 기업정보</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => setShowCompanyInfo(false)}
                ></button>
              </div>
              <div className="modal-body" style={{ height: 'calc(100% - 56px)', padding: 0 }}>
                <iframe
                  src={getNaverFinanceUrl(selectedStock.ticker)}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none'
                  }}
                  title="기업정보"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 거래내역 수정 모달 */}
      {showEditTradeModal && editingTrade && (
        <div className="modal edit-trade-modal" style={{display: 'block', backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">거래내역 수정</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => {
                    setShowEditTradeModal(false);
                    setEditingTrade(null);
                    setEditTradeForm({ price: '', quantity: '', type: 'buy' });
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">매수가격</label>
                  <input
                    type="number"
                    className="form-control"
                    value={editTradeForm.price}
                    onChange={(e) => setEditTradeForm({...editTradeForm, price: e.target.value})}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">수량</label>
                  <input
                    type="number"
                    className="form-control"
                    value={editTradeForm.quantity}
                    onChange={(e) => setEditTradeForm({...editTradeForm, quantity: e.target.value})}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">거래 유형</label>
                  <select
                    value={editTradeForm.type}
                    onChange={(e) => setEditTradeForm({...editTradeForm, type: e.target.value})}
                    className="form-select"
                  >
                    <option value="buy">매수</option>
                    <option value="sell">매도</option>
                  </select>
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setShowEditTradeModal(false);
                    setEditingTrade(null);
                    setEditTradeForm({ price: '', quantity: '', type: 'buy' });
                  }}
                >
                  취소
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary"
                  onClick={handleSaveTradeEdit}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 현금 관리 모달 */}
      {showCashModal && (
        <div className="modal" style={{display: 'block', backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">현금 관리</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => setShowCashModal(false)}
                ></button>
              </div>
              <div className="modal-body">
                {/* 현재 현금 정보 - 작게 표시 */}
                <div className="d-flex justify-content-between mb-3">
                  <small className="text-muted">
                    현재 원화: {Math.round(parseFloat(cashKRW.amount) || 0).toLocaleString()}원
                  </small>
                  <small className="text-muted">
                    현재 달러: ${Math.round(parseFloat(cashUSD.amount) || 0).toLocaleString()}
                  </small>
                </div>
                
                {/* 현금 입출금 폼 */}
                <div className="card mb-4">
                  <div className="card-header">
                    <h6 className="mb-0">현금 입출금</h6>
                  </div>
                  <div className="card-body">
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label">날짜</label>
                        <input
                          type="date"
                          className="form-control"
                          value={cashForm.date}
                          onChange={(e) => setCashForm({...cashForm, date: e.target.value})}
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">금액</label>
                        <input
                          type="number"
                          className="form-control"
                          value={cashForm.amount}
                          onChange={(e) => setCashForm({...cashForm, amount: e.target.value})}
                          placeholder="입금은 양수, 출금은 음수로 입력"
                        />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">통화</label>
                        <select
                          className="form-select"
                          value={cashForm.currency}
                          onChange={(e) => setCashForm({...cashForm, currency: e.target.value})}
                        >
                          <option value="KRW">원화 (KRW)</option>
                          <option value="USD">달러 (USD)</option>
                        </select>
                      </div>
                      <div className="col-md-6">
                        <label className="form-label">설명</label>
                        <input
                          type="text"
                          className="form-control"
                          value={cashForm.description}
                          onChange={(e) => setCashForm({...cashForm, description: e.target.value})}
                        />
                      </div>
                      <div className="col-12">
                        <button 
                          type="button" 
                          className="btn btn-primary"
                          onClick={handleCashUpdate}
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* 현금 증감 내역 - 월별 드롭다운으로 변경 */}
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <div className="d-flex align-items-center">
                    <select 
                      className="form-select form-select-sm" 
                      style={{ width: '150px' }}
                      value={selectedMonth}
                      onChange={handleMonthChange}
                    >
                      {Object.keys(cashHistory).length > 0 ? (
                        Object.keys(cashHistory)
                          .sort()
                          .reverse()
                          .map(month => (
                            <option key={month} value={month}>
                              {month.replace('-', '년 ')}월
                            </option>
                          ))
                      ) : (
                        <option value={new Date().toISOString().substring(0, 7)}>
                          {new Date().toISOString().substring(0, 7).replace('-', '년 ')}월
                        </option>
                      )}
                    </select>
                  </div>
                </div>

                {/* 현금 증감 내역 테이블 - 통화별 합계 추가 */}
                {Object.keys(cashHistory).length > 0 ? (
                  selectedMonth && cashHistory[selectedMonth] ? (
                    <div className="card mb-3">
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0">
                          <thead>
                            <tr>
                              <th>날짜</th>
                              <th>내용</th>
                              <th>금액</th>
                              <th>통화</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cashHistory[selectedMonth].map((item, index) => (
                              <tr key={index}>
                                <td>{item.date}</td>
                                <td>
                                  {item.type === 'stock_buy' && (
                                    <span>{item.companyName} {item.quantity}주 매수</span>
                                  )}
                                  {item.type === 'stock_sell' && (
                                    <span>{item.companyName} {item.quantity}주 매도</span>
                                  )}
                                  {(item.type === 'deposit' || item.type === 'withdraw') && (
                                    <span>{item.description}</span>
                                  )}
                                </td>
                                <td className={item.amount > 0 ? 'text-success' : 'text-danger'}>
                                  {item.amount > 0 ? '+' : ''}{item.amount.toLocaleString()}
                                </td>
                                <td>{item.currency}</td>
                              </tr>
                            ))}
                            
                            {/* 통화별 합계 행 추가 */}
                            <tr className="currency-total-row">
                              <td colSpan="2" className="fw-bold text-end">KRW 합계:</td>
                              <td className="fw-bold">
                                {cashHistory[selectedMonth]
                                  .filter(item => item.currency === 'KRW')
                                  .reduce((sum, item) => sum + item.amount, 0)
                                  .toLocaleString()}
                              </td>
                              <td>KRW</td>
                            </tr>
                            <tr className="currency-total-row">
                              <td colSpan="2" className="fw-bold text-end">USD 합계:</td>
                              <td className="fw-bold">
                                {cashHistory[selectedMonth]
                                  .filter(item => item.currency === 'USD')
                                  .reduce((sum, item) => sum + item.amount, 0)
                                  .toLocaleString()}
                              </td>
                              <td>USD</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="alert alert-info">선택한 월에 내역이 없습니다.</div>
                  )
                ) : (
                  <div className="alert alert-info">현금 증감 내역이 없습니다.</div>
                )}
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setShowCashModal(false);
                    setCashForm({ amount: '', description: '', currency: 'KRW' });
                  }}
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 메모 모달 */}
      {showMemoModal && (
        <div className="modal" style={{display: 'block', backgroundColor: 'rgba(0,0,0,0.5)'}}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">메모 관리</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => setShowMemoModal(false)}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">날짜</label>
                  <input
                    type="date"
                    className="form-control"
                    value={newMemo.date}
                    onChange={(e) => setNewMemo({...newMemo, date: e.target.value})}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">내용</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={newMemo.content}
                    onChange={(e) => setNewMemo({...newMemo, content: e.target.value})}
                  ></textarea>
                </div>
                <button 
                  className="btn btn-primary mb-3"
                  onClick={handleAddMemo}
                >
                  메모 추가
                </button>

                <div className="memos-list">
                  {memos.map(memo => (
                    <div key={memo.id} className="card mb-2">
                      <div className="card-body">
                        <h6 className="card-subtitle mb-2 text-muted">
                          {new Date(memo.date).toLocaleDateString()}
                        </h6>
                        {editingMemo?.id === memo.id ? (
                          <>
                            <input
                              type="date"
                              className="form-control mb-2"
                              value={editingMemo.date}
                              onChange={(e) => setEditingMemo({...editingMemo, date: e.target.value})}
                            />
                            <textarea
                              className="form-control mb-2"
                              rows="3"
                              value={editingMemo.content}
                              onChange={(e) => setEditingMemo({...editingMemo, content: e.target.value})}
                            ></textarea>
                            <div className="btn-group">
                              <button 
                                className="btn btn-sm btn-success me-2"
                                onClick={() => handleEditMemo(editingMemo)}
                              >
                                저장
                              </button>
                              <button 
                                className="btn btn-sm btn-secondary"
                                onClick={() => setEditingMemo(null)}
                              >
                                취소
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="card-text" style={{whiteSpace: 'pre-wrap'}}>{memo.content}</p>
                            <div className="btn-group">
                              <button 
                                className="btn btn-sm btn-primary me-2"
                                onClick={() => setEditingMemo(memo)}
                              >
                                수정
                              </button>
                              <button 
                                className="btn btn-sm btn-danger"
                                onClick={() => handleDeleteMemo(memo.id)}
                              >
                                삭제
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default React.memo(StockTable, areEqual);