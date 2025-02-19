import React, { useState, useEffect, useCallback, useRef } from 'react';
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

export const StockTable = ({ stocks }) => {
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
    memo: ''
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
    quantity: ''
  });
  const [sortConfig, setSortConfig] = useState({
    key: null,
    direction: 'ascending'
  });

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

  // 주식 현재가 업데이트 함수
  const updateStockPrices = useCallback(async (existingTickers) => {
    if (!stocks || stocks.length === 0) return;

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const response  = await fetch('https://visualp.p-e.kr/api/stock-price?ticker=KRW=X');
      const data = await response.json();
      const usdToKrw = data.price;

      // 현재 DB에 있는 주식 목록 확인
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const snapshot = await get(stocksRef);
      const existingStocks = snapshot.val() || {};

      const updatedStocks = await Promise.all(
        stocks
          .filter(stock => existingTickers.has(stock.ticker)) // 현재 존재하는 주식만 업데이트
          .map(async (stock) => {
            try {
              // 삭제된 주식은 업데이트하지 않음
              if (!existingStocks[stock.ticker]) {
                return null;
              }

              // 현재 DB에 저장된 주식 데이터
              const currentStockData = existingStocks[stock.ticker];
              
              console.log(`Fetching price for ${stock.ticker}`);
              
              const response = await fetch(`https://visualp.p-e.kr/api/stock-price?ticker=${stock.ticker}`);
              const data = await response.json();
              
              const isUSStock = !/^\d+$/.test(stock.ticker);
              
              let currentPrice;
              if (typeof data.price === 'string') {
                currentPrice = parseFloat(data.price.replace(/,/g, ''));
              } else {
                currentPrice = parseFloat(data.price);
              }

              if (isNaN(currentPrice)) {
                console.error('Invalid current price:', data.price);
                return currentStockData; // 현재가 업데이트 실패시 기존 데이터 유지
              }

              const trades = Array.isArray(currentStockData.trades) ? currentStockData.trades : [];
              const totalQuantity = trades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
              const avgPrice = parseFloat(currentStockData.avgPrice) || 0;
              
              const profit = (currentPrice - avgPrice) * totalQuantity;
              const profitRate = avgPrice !== 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

              const valueInKRW = isUSStock ? 
                (currentPrice * totalQuantity * usdToKrw) : 
                (currentPrice * totalQuantity);

              // 기존 데이터를 유지하면서 필요한 필드만 업데이트
              return {
                ...currentStockData,
                currentPrice,
                profit: profit || 0,
                profitRate: (profitRate || 0).toFixed(2),
                valueInKRW: valueInKRW.toFixed(0),
                totalQuantity
              };
            } catch (error) {
              console.error(`Error updating ${stock.ticker}:`, error);
              return existingStocks[stock.ticker]; // 에러 발생시 기존 데이터 유지
            }
          })
      );

      // null 값과 undefined 제거
      const filteredStocks = updatedStocks.filter(stock => stock !== null && stock !== undefined);

      // 전체 포트폴리오 가치 계산
      const totalValue = filteredStocks.reduce((sum, stock) => {
        const trades = Array.isArray(stock.trades) ? stock.trades : [];
        if (trades.length === 0) return sum;
        return sum + parseFloat(stock.valueInKRW || 0);
      }, 0);

      // 비중 계산 및 업데이트
      for (const stock of filteredStocks) {
        const trades = Array.isArray(stock.trades) ? stock.trades : [];
        if (trades.length === 0) continue;

        const valueInKRW = parseFloat(stock.valueInKRW || 0);
        const weight = totalValue > 0 ? (valueInKRW / totalValue) * 100 : 0;

        const stockRef = ref(db, `users/${userId}/stocks/${stock.ticker}`);
        await set(stockRef, {
          ...stock,
          weight: weight.toFixed(2)
        });
      }

    } catch (error) {
      console.error("Error updating stock prices:", error);
    }
  }, [stocks]);

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

  // 비중 재계산 함수 추가
  const recalculateWeights = async () => {
    const db = getDatabase();
    const userId = auth.currentUser.uid;
    const usdToKrw = 1450;
    
    try {
      // 모든 주식 데이터 가져오기
      const stocksRef = ref(db, `users/${userId}/stocks`);
      const snapshot = await get(stocksRef);
      const allStocks = snapshot.val() || {};

      // 전체 포트폴리오 가치 계산 (원화 기준)
      let totalValue = 0;
      Object.values(allStocks).forEach(stock => {
        const trades = Array.isArray(stock.trades) ? stock.trades : [];
        if (trades.length === 0) return;
        
        const isUSStock = !/^\d+$/.test(stock.ticker);
        const currentPrice = parseFloat(stock.currentPrice) || 0;
        const totalQuantity = trades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
        const valueInKRW = isUSStock ? 
          (currentPrice * totalQuantity * usdToKrw) : 
          (currentPrice * totalQuantity);
        totalValue += valueInKRW;
      });

      // 각 주식의 비중 계산 및 업데이트
      for (const stock of Object.values(allStocks)) {
        const stockRef = ref(db, `users/${userId}/stocks/${stock.ticker}`);
        const currentStockData = await get(stockRef);
        const currentStock = currentStockData.val();

        const trades = Array.isArray(currentStock.trades) ? currentStock.trades : [];
        if (trades.length === 0) continue;

        const isUSStock = !/^\d+$/.test(stock.ticker);
        const currentPrice = parseFloat(currentStock.currentPrice) || 0;
        const totalQuantity = trades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
        const valueInKRW = isUSStock ? 
          (currentPrice * totalQuantity * usdToKrw) : 
          (currentPrice * totalQuantity);
        const weight = totalValue > 0 ? (valueInKRW / totalValue) * 100 : 0;

        await set(stockRef, {
          ...currentStock,
          weight: weight.toFixed(2),
          valueInKRW: valueInKRW.toFixed(0)
        });
      }
    } catch (error) {
      console.error("Error in recalculateWeights:", error);
    }
  };

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

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      
      // 현재 주식 데이터 가져오기
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 새로운 거래 데이터
      const trade = {
        date: newTrade.date,
        price: parseFloat(newTrade.price),
        quantity: parseFloat(newTrade.quantity),
        memo: newTrade.memo || '',
        id: Date.now()
      };

      // 기존 거래내역 배열이 없으면 새로 생성
      let trades = currentStock && Array.isArray(currentStock.trades) ? [...currentStock.trades] : [];
      trades.push(trade);

      // 평균 매수가격 계산
      const totalQuantity = trades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
      const totalCost = trades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.quantity)), 0);
      const avgPrice = totalCost / totalQuantity;

      // 현재가 조회
      console.log(`Fetching price for ${selectedStock.ticker}`);
      const response = await fetch(`https://visualp.p-e.kr/api/stock-price?ticker=${selectedStock.ticker}`);
      const data = await response.json();
      
      // 미국/한국 주식 구분
      const isUSStock = !/^\d+$/.test(selectedStock.ticker);
      console.log(`${selectedStock.ticker} is US Stock:`, isUSStock);
      
      // 현재가 변환
      let currentPrice;
      if (typeof data.price === 'string') {
        currentPrice = parseFloat(data.price.replace(/,/g, ''));
      } else {
        currentPrice = parseFloat(data.price);
      }
      console.log(`${selectedStock.ticker} current price:`, currentPrice);
      
      console.log(`${selectedStock.ticker} total quantity:`, totalQuantity);

      // 손익 계산
      const profit = (currentPrice - avgPrice) * totalQuantity;
      const profitRate = avgPrice !== 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

      // 원화 가치 계산
      const usdToKrw = 1450;
      const valueInKRW = isUSStock ? 
        (currentPrice * totalQuantity * usdToKrw) : 
        (currentPrice * totalQuantity);
      
      console.log(`${selectedStock.ticker} value in KRW:`, valueInKRW);

      // 업데이트할 주식 데이터
      const updatedStock = {
        ...currentStock,
        avgPrice: avgPrice.toFixed(2),
        trades: trades,
        currentPrice,
        profit: profit.toFixed(2),
        profitRate: profitRate.toFixed(2),
        valueInKRW: valueInKRW.toFixed(0)
      };

      // Firebase에 데이터 저장
      await set(stockRef, updatedStock);
      
      // 전체 비중 재계산
      await recalculateWeights();

      // 선택된 주식 정보 업데이트
      setSelectedStock(updatedStock);

      // 입력 폼 초기화
      setNewTrade({
        date: new Date().toISOString().split('T')[0],
        price: '',
        quantity: '',
        memo: ''
      });
      
      console.log("Trade added successfully:", trade);
    } catch (error) {
      console.error("Error in handleAddTrade:", error);
      alert("거래내역 추가 중 오류가 발생했습니다.");
    }
  };

  // 거래내역 삭제
  const handleDeleteTrade = async (tradeId) => {
    if (!window.confirm("이 거래내역을 삭제하시겠습니까?")) {
      return;
    }

    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);

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
    } catch (error) {
      console.error("Error deleting trade:", error);
      alert("거래내역 삭제 중 오류가 발생했습니다.");
    }
  };

  // 거래내역 필드 수정 함수 추가
  const handleEditTradeField = async (tradeId, field, value) => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      
      // 현재 주식 데이터를 가져옴
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 거래 내역 배열에서 해당 tradeId의 필드를 업데이트
      const updatedTrades = currentStock.trades.map(trade => {
        if (trade.id === tradeId) {
          return { 
            ...trade, 
            [field]: field === 'price' || field === 'quantity' ? parseFloat(value) : value 
          };
        }
        return trade;
      });

      // 평균 매수가격 재계산
      const totalQuantity = updatedTrades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
      const totalCost = updatedTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.quantity)), 0);
      const avgPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;

      // 손익 재계산
      const currentPrice = parseFloat(currentStock.currentPrice);
      const profit = (currentPrice - avgPrice) * totalQuantity;
      const profitRate = avgPrice !== 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

      // 원화 가치 재계산
      const isUSStock = !/^\d+$/.test(selectedStock.ticker);
      const usdToKrw = 1450;
      const valueInKRW = isUSStock ? 
        (currentPrice * totalQuantity * usdToKrw) : 
        (currentPrice * totalQuantity);

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

      console.log(`Trade ${field} updated successfully`);
    } catch (error) {
      console.error(`Error updating trade ${field}:`, error);
      alert(`거래내역 ${field} 수정 중 오류가 발생했습니다.`);
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
      quantity: trade.quantity
    });
    setShowEditTradeModal(true);
  };

  // 거래내역 수정 저장
  const handleSaveTradeEdit = async () => {
    try {
      const db = getDatabase();
      const userId = auth.currentUser.uid;
      const stockRef = ref(db, `users/${userId}/stocks/${selectedStock.ticker}`);
      
      // 현재 주식 데이터를 가져옴
      const snapshot = await get(stockRef);
      const currentStock = snapshot.val();

      // 거래 내역 배열에서 수정할 거래 업데이트
      const updatedTrades = currentStock.trades.map(trade => {
        if (trade.id === editingTrade.id) {
          return { 
            ...trade, 
            price: parseFloat(editTradeForm.price),
            quantity: parseFloat(editTradeForm.quantity)
          };
        }
        return trade;
      });

      // 평균 매수가격 재계산
      const totalQuantity = updatedTrades.reduce((sum, t) => sum + parseFloat(t.quantity), 0);
      const totalCost = updatedTrades.reduce((sum, t) => sum + (parseFloat(t.price) * parseFloat(t.quantity)), 0);
      const avgPrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;

      // 손익 재계산
      const currentPrice = parseFloat(currentStock.currentPrice);
      const profit = (currentPrice - avgPrice) * totalQuantity;
      const profitRate = avgPrice !== 0 ? ((currentPrice - avgPrice) / avgPrice) * 100 : 0;

      // 원화 가치 재계산
      const isUSStock = !/^\d+$/.test(selectedStock.ticker);
      const usdToKrw = 1450;
      const valueInKRW = isUSStock ? 
        (currentPrice * totalQuantity * usdToKrw) : 
        (currentPrice * totalQuantity);

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
      setEditTradeForm({ price: '', quantity: '' });

      console.log("Trade updated successfully");
    } catch (error) {
      console.error("Error updating trade:", error);
      alert("거래내역 수정 중 오류가 발생했습니다.");
    }
  };

  return (
    <div className="stock-table-container">
      <div className="table-header">
        <h2>주식 포트폴리오</h2>
        <button onClick={() => setShowAddModal(true)}>추가</button>
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
            
            const totalInvestment = trades.reduce((sum, trade) => 
              sum + (parseFloat(trade.price) * parseFloat(trade.quantity)), 0);
            
            const profit = parseFloat(stock.profit);
            const profitRate = parseFloat(stock.profitRate);
            
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
                <td>{totalInvestment.toLocaleString()}</td>
                <td>{parseFloat(stock.avgPrice).toLocaleString()}</td>
                <td>{parseFloat(stock.currentPrice).toLocaleString()}</td>
                <td style={profitStyle}>
                  {Number(stock.currentPrice * stock.totalQuantity).toLocaleString()}원
                  <br />
                  ({formattedProfit})
                </td>
                <td style={profitRateStyle}>
                  {formattedProfitRate}%
                </td>
                <td>{stock.weight}%</td>
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
                        <th>매수가격</th>
                        <th>수량</th>
                        <th>현재가격</th>
                        <th>평가수익</th>
                        <th>수익률</th>
                        <th>메모</th>
                        <th>메모수정</th>
                        <th>삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(selectedStock.trades) ? selectedStock.trades.map((trade) => (
                        <tr key={trade.id}>
                          <td>
                            <input
                              type="date"
                              value={trade.date}
                              onChange={(e) => handleEditTradeField(trade.id, 'date', e.target.value)}
                              style={{ width: '130px' }}
                            />
                          </td>
                          <td>{Number(trade.price).toLocaleString()}</td>
                          <td>{trade.quantity}</td>
                          <td>{Number(selectedStock.currentPrice).toLocaleString()}</td>
                          <td>{Number((selectedStock.currentPrice - trade.price) * trade.quantity).toLocaleString()}</td>
                          <td>{((selectedStock.currentPrice - trade.price) / trade.price * 100).toFixed(2)}%</td>
                          <td>{trade.memo}</td>
                          <td>
                            <button 
                              onClick={() => handleOpenEditTradeModal(trade)}
                              className="btn btn-primary btn-sm me-2"
                            >
                              수정
                            </button>
                            <button 
                              onClick={() => handleEditTrade(trade.id)}
                              className="btn btn-warning btn-sm me-2"
                            >
                              메모수정
                            </button>
                          </td>
                          <td>
                            <button 
                              onClick={() => handleDeleteTrade(trade.id)}
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
                    setEditTradeForm({ price: '', quantity: '' });
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
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setShowEditTradeModal(false);
                    setEditingTrade(null);
                    setEditTradeForm({ price: '', quantity: '' });
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
    </div>
  );
};

export default React.memo(StockTable, areEqual);