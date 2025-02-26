import React, { useState, useEffect, useCallback } from 'react';
import { auth, database } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { signOut } from 'firebase/auth';
import StockTable from '../components/StockTable';
import Summary from '../components/Summary';
import './Main.css';
import { getDatabase, get } from 'firebase/database';

function Main() {
  const [activeTab, setActiveTab] = useState('summary');
  const [stocks, setStocks] = useState([]);
  const [cashAmount, setCashAmount] = useState(0);

  useEffect(() => {
    const userStocksRef = ref(database, `users/${auth.currentUser.uid}/stocks`);
    
    const unsubscribe = onValue(userStocksRef, (snapshot) => {
      if (snapshot.exists()) {
        const stocksData = snapshot.val();
        const stocksList = Object.entries(stocksData)
          .filter(([_, stock]) => stock !== null)
          .map(([_, stock]) => ({
            ...stock,
            avgPrice: parseFloat(stock.avgPrice),
          }));
        setStocks(stocksList);
      } else {
        setStocks([]);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const fetchCashAmount = async () => {
      try {
        const db = getDatabase();
        const userId = auth.currentUser.uid;
        const cashRef = ref(db, `users/${userId}/cash`);
        const snapshot = await get(cashRef);
        if (snapshot.exists()) {
          setCashAmount(snapshot.val().amount || 0);
        }
      } catch (error) {
        console.error("Error fetching cash amount:", error);
      }
    };

    fetchCashAmount();
  }, []);

  const handleLogout = () => {
    signOut(auth);
  };

  const refreshStocks = useCallback(async () => {
    const userStocksRef = ref(database, `users/${auth.currentUser.uid}/stocks`);
    const snapshot = await get(userStocksRef);
    if (snapshot.exists()) {
      const stocksData = snapshot.val();
      const stocksList = Object.entries(stocksData)
        .filter(([_, stock]) => stock !== null)
        .map(([_, stock]) => stock);
      setStocks(stocksList);
    } else {
      setStocks([]);
    }
  }, []);

  return (
    <div className="main-container">
      <div className="header">
        <button onClick={handleLogout} className="logout-button">Logout</button>
      </div>
      
      <div className="tabs">
        <button 
          className={activeTab === 'summary' ? 'active' : ''} 
          onClick={() => setActiveTab('summary')}
        >
          Summary
        </button>
        <button 
          className={activeTab === 'table' ? 'active' : ''} 
          onClick={() => setActiveTab('table')}
        >
          Table
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'summary' && <Summary stocks={stocks} cashAmount={cashAmount} />}
        {activeTab === 'table' && <StockTable stocks={stocks} onCashUpdate={setCashAmount} onStocksUpdate={refreshStocks} />}
      </div>
    </div>
  );
}

export default Main; 