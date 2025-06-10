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
  // eslint-disable-next-line no-unused-vars
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
    const fetchCashInfo = async () => {
      try {
        const db = getDatabase();
        const userId = auth.currentUser.uid;
        
        const cashKRWRef = ref(db, `users/${userId}/cash_krw`);
        const cashKRWSnapshot = await get(cashKRWRef);
        
        if (cashKRWSnapshot.exists()) {
          const cashKRWData = cashKRWSnapshot.val();
          setCashAmount(parseFloat(cashKRWData.amount) || 0);
        }
      } catch (error) {
        console.error("Error fetching cash info:", error);
      }
    };

    fetchCashInfo();
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
        <button 
          className={activeTab === 'sepa' ? 'active' : ''} 
          onClick={() => setActiveTab('sepa')}
        >
          Sepa
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'summary' && <Summary stocks={stocks} />}
        {activeTab === 'table' && <StockTable stocks={stocks} onCashUpdate={setCashAmount} onStocksUpdate={refreshStocks} />}
        {activeTab === 'sepa' && (
          <div className="sepa-container">
            <iframe
              src="https://elemraty-screener-v2-app-p89wad.streamlit.app/?embed=true"
              title="Sepa"
              width="100%"
              height="2000px"
              frameBorder="0"
              style={{ border: 'none' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default Main; 