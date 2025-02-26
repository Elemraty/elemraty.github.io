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
    key: null,
    direction: 'ascending'
  });

  // 현금 관련 state 추가
  const [cashAmount, setCashAmount] = useState(0);
  const [cashWeight, setCashWeight] = useState(0);
  const [showCashModal, setShowCashModal] = useState(false);
  const [cashForm, setCashForm] = useState({
    amount: '',
    description: ''
  });

  // state 추가
  const [showMemoModal, setShowMemoModal] = useState(false);
  const [memos, setMemos] = useState([]);
  const [newMemo, setNewMemo] = useState({
    content: '',
    date: new Date().toISOString().split('T')[0]
  });

  // state 추가
  const [editingMemo, setEditingMemo] = useState(null);

  // 총계 계산을 위한 useMemo 추가
  const totals = useMemo(() => {
    const validStocks = stocks.filter(stock => Array.isArray(stock.trades) && stock.trades.length > 0);
    
    return validStocks.reduce((acc, stock) => {
      const trades = stock.trades;
      const currentQuantity = trades.reduce((sum, t) => {
        if (t.type === 'buy') return sum + parseFloat(t.quantity);
        if (t.type === 'sell') return sum - parseFloat(t.quantity);
        return sum;
      }, 0);

      if (currentQuantity > 0) {
        const isUSStock = !/^\d+$/.test(stock.ticker);
        // 총 투자금액
        const totalInvestment = trades.reduce((sum, t) => {
          if (t.type === 'buy') {
            const amount = parseFloat(t.price) * parseFloat(t.quantity);
            return sum + (isUSStock ? amount * 1450 : amount);
          }
          return sum;
        }, 0);

        // 평가금액
        const evaluationValue = parseFloat(stock.valueInKRW || 0);

        acc.totalInvestment += totalInvestment;
        acc.totalEvaluation += evaluationValue;
      }
      return acc;
    }, { totalInvestment: 0, totalEvaluation: 0 });
  }, [stocks]);

  // updateCashAmount를 useCallback으로 감싸고 최상단으로 이동
  const updateCashAmount = useCallback((amount) => {
    setCashAmount(amount);
    onCashUpdate(amount);
  }, [onCashUpdate]);

  // 정렬 함수 추가
  const requestSort = (key) => {
    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
      direction = 'ascending';
    }
    setSortConfig({ key, direction });
  };

  // 정렬된 데이터 가져오기
  const getSortedStocks = (stocksToSort) => {
    if (!sortConfig.key) return stocksToSort;

    return [...stocksToSort].sort((a, b) => {
      let aValue, bValue;
      
      switch(sortConfig.key) {
        case 'sector':
        case 'category':
        case 'volatility':
          aValue = a[sortConfig.key] || '';
          bValue = b[sortConfig.key] || '';
          break;
        case 'totalInvestment':
          aValue = Array.isArray(a.trades) ? a.trades.reduce((sum, trade) => 
            sum + (parseFloat(trade.price) * parseFloat(trade.quantity)), 0) : 0;
          bValue = Array.isArray(b.trades) ? b.trades.reduce((sum, trade) => 
            sum + (parseFloat(trade.price) * parseFloat(trade.quantity)), 0) : 0;
          break;
        case 'avgPrice':
        case 'currentPrice':
          aValue = parseFloat(a[sortConfig.key]) || 0;
          bValue = parseFloat(b[sortConfig.key]) || 0;
          break;
        case 'evaluationValue':
          aValue = (a.currentPrice * a.totalQuantity) || 0;
          bValue = (b.currentPrice * b.totalQuantity) || 0;
          break;
        case 'profit':
          aValue = parseFloat(a.profit) || 0;
          bValue = parseFloat(b.profit) || 0;
          break;
        case 'profitRate':
          aValue = parseFloat(a.profitRate) || 0;
          bValue = parseFloat(b.profitRate) || 0;
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
  };

  // 정렬 방향 표시 아이콘
  const getSortDirectionIcon = (key) => {
    if (sortConfig.key !== key) return '↕️';
    return sortConfig.direction === 'ascending' ? '↑' : '↓';
  };

  // recalculateWeights 함수의 의존성 배열 수정
  const recalculateWeights = useCallback(async () => {
    const db = getDatabase();
    const userId = auth.currentUser.uid;
    
    try {
      // 모든 주식 데이터 가져오기
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const snapshot = await get(stocksRef);
      const allStocks = snapshot.val() || {};

      // 현금 정보 가져오기
      const cashRef = ref(db, `users/${userId}/cash`);
      const cashSnapshot = await get(cashRef);
      let currentCash = cashSnapshot.val()?.amount || 0;

      // 유효한 주식만 필터링
      const validStocks = Object.values(allStocks)
        .filter(stock => 
          stock !== null && 
          Array.isArray(stock.trades) && 
          stock.trades.length > 0
        );

      // 총 가치 계산
      const totalValue = validStocks.reduce((sum, stock) => {
        return sum + (parseFloat(stock.valueInKRW) || 0);
      }, currentCash);

      // 각 주식의 비중 계산
      validStocks.forEach(async (stock) => {
        const weight = ((stock.valueInKRW / totalValue) * 100).toFixed(2);
        const stockRef = ref(db, `users/${userId}/stocks/${stock.ticker}`);
        await set(stockRef, {
          ...stock,
          weight: weight
        });
      });

      // 비중 계산 및 업데이트
      const cashWeight = totalValue > 0 ? (currentCash / totalValue * 100) : 0;
      await set(cashRef, {
        amount: Math.round(currentCash),
        weight: parseFloat(cashWeight).toFixed(2)
      });
      updateCashAmount(Math.round(currentCash));
      setCashWeight(parseFloat(cashWeight).toFixed(2));

    } catch (error) {
      console.error("Error in recalculateWeights:", error);
    }
  }, [updateCashAmount]);

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

  // 거래내역 추가
  const handleAddTrade = async () => {
    if (!newTrade.date || !newTrade.price || !newTrade.quantity) {
      alert("날짜, 가격, 수량을 입력해주세요.");
      return;
    }

    const isUSStock = !/^\d+$/.test(selectedStock.ticker);
    let usdToKrw = 1450; // 기본값

    if (isUSStock) {
      try {
        const response = await fetch('https://visualp.p-e.kr/api/stock-price?ticker=KRW=X');
        const data = await response.json();
        usdToKrw = parseFloat(data.price) || 1450;
      } catch (error) {
        console.error('환율 조회 실패:', error);
      }
    }

    // 거래 금액 계산 (원화 기준)
    const tradeAmount = parseFloat(newTrade.price) * parseFloat(newTrade.quantity);
    const tradeAmountKRW = isUSStock ? tradeAmount * usdToKrw : tradeAmount;

    // 매수 시 현금 잔액 체크
    if (newTrade.type === 'buy' && tradeAmountKRW > cashAmount) {
      alert("현금이 부족합니다.");
      return;
    }

    // 매도 시 보유 수량 체크
    if (newTrade.type === 'sell') {
      // 현재 보유 수량 계산 (매수 수량 합계 - 매도 수량 합계)
      const currentQuantity = selectedStock.trades.reduce((sum, t) => {
        if (t.type === 'buy') {
          return sum + parseFloat(t.quantity);
        } else if (t.type === 'sell') {
          return sum - parseFloat(t.quantity);
        }
        return sum;
      }, 0);
      
      console.log('현재 보유 수량:', currentQuantity);
      console.log('매도 시도 수량:', parseFloat(newTrade.quantity));
      
      if (parseFloat(newTrade.quantity) > currentQuantity) {
        alert(`매도 가능 수량(${currentQuantity}주)을 초과합니다.`);
        return;
      }
    }

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      const cashRef = ref(db, `users/${userId}/cash`);
      
      // 현재 현금 잔액 가져오기
      const cashSnapshot = await get(cashRef);
      let currentCash = cashSnapshot.val()?.amount || 0;

      // 기존 거래내역 배열이 없으면 새로 생성
      let trades = Array.isArray(selectedStock.trades) ? [...selectedStock.trades] : [];

      // 새로운 거래 데이터
      const trade = {
        date: newTrade.date,
        price: parseFloat(newTrade.price),
        quantity: parseFloat(newTrade.quantity),
        memo: newTrade.memo || '',
        type: newTrade.type,
        id: Date.now()
      };

      // 매도 거래의 경우 현재 평균매수가 저장
      if (newTrade.type === 'sell') {
        // 매도 시점의 평균매수가 계산
        const totalBuyCost = trades.reduce((sum, t) => {
          if (t.type === 'buy') return sum + (parseFloat(t.price) * parseFloat(t.quantity));
          return sum;
        }, 0);

        const totalBuyQuantity = trades.reduce((sum, t) => {
          if (t.type === 'buy') return sum + parseFloat(t.quantity);
          return sum;
        }, 0);

        const avgPrice = totalBuyQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
        trade.avgBuyPrice = avgPrice;
      }

      // 거래 추가
      trades.push(trade);

      // 현재 보유 수량 계산
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

      // 손익 계산
      const profit = currentQuantity > 0 ? (selectedStock.currentPrice - avgPrice) * currentQuantity : 0;
      const profitRate = currentQuantity > 0 && avgPrice !== 0 ? 
        ((selectedStock.currentPrice - avgPrice) / avgPrice) * 100 : 0;

      // 원화 가치 계산
      const valueInKRW = isUSStock ? 
        (selectedStock.currentPrice * currentQuantity * usdToKrw) : 
        (selectedStock.currentPrice * currentQuantity);

      // 업데이트할 주식 데이터
      const updatedStock = {
        ...selectedStock,
        trades,
        avgPrice: avgPrice.toFixed(2),
        profit: profit.toFixed(2),
        profitRate: profitRate.toFixed(2),
        valueInKRW: valueInKRW.toFixed(0),
        currentQuantity
      };

      // Firebase에 데이터 저장
      await set(stockRef, updatedStock);

      // 현금 업데이트
      if (newTrade.type === 'buy') {
        currentCash -= tradeAmountKRW;
      } else {
        currentCash += tradeAmountKRW;
      }

      await set(cashRef, {
        ...cashSnapshot.val(),
        amount: Math.round(currentCash)
      });
      
      // 전체 비중 재계산
      await recalculateWeights();

      // 선택된 주식 정보 업데이트
      setSelectedStock(updatedStock);

      // 입력 폼 초기화
      setNewTrade({
        date: new Date().toISOString().split('T')[0],
        price: '',
        quantity: '',
        memo: '',
        type: 'buy'
      });
      
      console.log("Trade added successfully:", trade);
    } catch (error) {
      console.error("Error in handleAddTrade:", error);
      alert("거래내역 추가 중 오류가 발생했습니다.");
    }
  };

  // 거래내역 삭제
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

      // 거래내역이 있는 경우에만 평균가 계산
      let avgPrice = 0;
      if (updatedTrades.length > 0) {
        const totalQuantity = updatedTrades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
        const totalCost = updatedTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.quantity)), 0);
        avgPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
      }

      const updatedStock = {
        ...currentStock,
        avgPrice: avgPrice.toFixed(2),
        trades: updatedTrades,
        currentPrice: currentStock.currentPrice || 0,
        profit: currentStock.profit || 0,
        profitRate: currentStock.profitRate || '0.00',
        weight: currentStock.weight || '0.00'
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

  // 거래내역 메모 수정
  const handleEditTrade = async (tradeId) => {
    // 현재 거래 내역 중 해당 tradeId에 해당하는 항목을 찾음
    const currentTrade = selectedStock.trades.find(trade => trade.id === tradeId);
    if (!currentTrade) return;
    
    // 기존 메모를 기본값으로 하는 prompt 창을 띄워서 새 메모를 입력받음
    const newMemo = window.prompt("새로운 메모를 입력하세요:", currentTrade.memo || "");
    if (newMemo === null) return; // 취소한 경우 아무 작업도 하지 않음

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      
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
      alert("거래내역 메모 수정 중 오류가 발생했습니다.");
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
          return { 
            ...trade, 
            price: parseFloat(editTradeForm.price),
            quantity: parseFloat(editTradeForm.quantity),
            type: editTradeForm.type
          };
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

  // 현금 정보 로드
  useEffect(() => {
    const loadCashInfo = async () => {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const cashRef = ref(db, `users/${userId}/cash`);
      
      const snapshot = await get(cashRef);
      const cashData = snapshot.val() || { amount: 0, weight: 0 };
      
      setCashAmount(cashData.amount);
      setCashWeight(cashData.weight);
    };

    loadCashInfo();
  }, []);

  // 현금 업데이트 함수
  const updateCash = async (amount, description, type) => {
    const db = getDatabase();
    const userId = auth.currentUser.uid;
    const cashRef = ref(db, `users/${userId}/cash`);
    
    const snapshot = await get(cashRef);
    const currentCash = snapshot.val()?.amount || 0;
    
    const newAmount = currentCash + amount;
    
    await set(cashRef, {
      amount: newAmount,
      transactions: [
        ...(snapshot.val()?.transactions || []),
        {
          date: new Date().toISOString().split('T')[0],
          amount,
          description,
          type,
          id: Date.now()
        }
      ]
    });
    
    updateCashAmount(Math.round(newAmount));
    return newAmount;
  };

  const handleCashUpdate = async () => {
    if (!cashForm.amount) {
      alert("금액을 입력해주세요.");
      return;
    }

    try {
      await updateCash(
        parseFloat(cashForm.amount),
        cashForm.description || '현금 조정',
        parseFloat(cashForm.amount) > 0 ? 'deposit' : 'withdraw'
      );

      // 모달 닫기 및 폼 초기화
      setShowCashModal(false);
      setCashForm({ amount: '', description: '' });

      // 전체 비중 재계산
      await recalculateWeights();

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
              총투자금액 {getSortDirectionIcon('totalInvestment')}
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
            // trades가 배열이 아닐 경우 빈 배열로 초기화
            const trades = Array.isArray(stock.trades) ? stock.trades : [];
            
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

            // 평균매수가는 현재 보유 수량이 있을 때만 표시
            const avgPrice = currentQuantity > 0 ? totalBuyCost / totalBuyQuantity : 0;
            
            // 평균 매수가로 총 투자금액 계산
            const totalInvestment = currentQuantity * avgPrice;
            
            // 평가금액 계산 (현재 보유 수량 기준)
            const evaluationValue = currentQuantity * parseFloat(stock.currentPrice);
            
            // 손익 계산 (현재 보유 수량 기준)
            const profit = currentQuantity > 0 ? (stock.currentPrice - avgPrice) * currentQuantity : 0;
            const profitRate = currentQuantity > 0 ? ((stock.currentPrice - avgPrice) / avgPrice * 100) : 0;
            
            const profitStyle = {
              color: profit > 0 ? 'red' : 
                     profit < 0 ? 'blue' : 'black'
            };
            
            const profitRateStyle = {
              color: profitRate > 0 ? 'red' : 
                     profitRate < 0 ? 'blue' : 'black'
            };

            // 수익과 수익률에 +/- 기호 추가
            const formattedProfit = profit > 0 ? `+${profit.toLocaleString()}` : 
                                   profit < 0 ? profit.toLocaleString() : 
                                   '0';

            const formattedProfitRate = profitRate > 0 ? `+${profitRate.toFixed(2)}` : 
                                       profitRate < 0 ? profitRate.toFixed(2) : 
                                       '0.00';

            return (
              <tr key={stock.ticker}>
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
                <td>{totalInvestment > 0 ? totalInvestment.toLocaleString() : '-'}</td>
                <td>{currentQuantity > 0 ? parseFloat(avgPrice).toLocaleString() : '-'}</td>
                <td>{parseFloat(stock.currentPrice).toLocaleString()}</td>
                <td style={profitStyle}>
                  {currentQuantity > 0 ? `${evaluationValue.toLocaleString()}원` : '-'}
                  <br />
                  {currentQuantity > 0 ? `(${formattedProfit})` : '-'}
                </td>
                <td style={profitRateStyle}>
                  {currentQuantity > 0 ? `${formattedProfitRate}%` : '-'}
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
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>{Math.round(totals.totalInvestment).toLocaleString()}</td>
            <td>-</td>
            <td>-</td>
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
            <td>-</td>
            <td colSpan="3">-</td>
          </tr>

          {/* 현금 행 */}
          <tr className="cash-row">
            <td>CASH</td>
            <td>현금자산</td>
            <td>-</td>
            <td>-</td>
            <td>-</td>
            <td>{Math.round(cashAmount).toLocaleString()}</td>
            <td>-</td>
            <td>-</td>
            <td>{Math.round(cashAmount).toLocaleString()}원</td>
            <td>-</td>
            <td>{parseFloat(cashWeight).toFixed(2)}%</td>
            <td colSpan="3">
              <button 
                className="btn btn-primary btn-sm"
                onClick={() => setShowCashModal(true)}
              >
                현금관리
              </button>
            </td>
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
                              ? `실현손익: ${Number((trade.price - trade.avgBuyPrice) * trade.quantity).toLocaleString()}`
                              : Number((selectedStock.currentPrice - trade.price) * trade.quantity).toLocaleString()
                            }
                          </td>
                          <td>
                            {trade.type === 'sell'
                              ? `${((trade.price - trade.avgBuyPrice) / trade.avgBuyPrice * 100).toFixed(2)}%`
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
          <div className="modal-dialog">
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
                <div className="alert alert-info">
                  현재 현금: {Math.round(cashAmount).toLocaleString()}원
                </div>
                <div className="mb-3">
                  <label className="form-label">금액</label>
                  <input
                    type="number"
                    className="form-control"
                    value={cashForm.amount}
                    onChange={(e) => setCashForm({...cashForm, amount: e.target.value})}
                    placeholder="입금은 양수, 출금은 음수로 입력"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">설명</label>
                  <input
                    type="text"
                    className="form-control"
                    value={cashForm.description}
                    onChange={(e) => setCashForm({...cashForm, description: e.target.value})}
                    
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setShowCashModal(false);
                    setCashForm({ amount: '', description: '' });
                  }}
                >
                  취소
                </button>
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