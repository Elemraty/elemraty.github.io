import React, { useState, useEffect } from 'react';
import { auth, database } from '../firebase';
import { ref, onValue } from 'firebase/database';
import { signOut } from 'firebase/auth';
import StockTable from '../components/StockTable';
import Summary from '../components/Summary';
import './Main.css';

function Main() {
  const [activeTab, setActiveTab] = useState('summary');
  const [stocks, setStocks] = useState([]);

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

  const handleLogout = () => {
    signOut(auth);
  };

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
        {activeTab === 'summary' && (
          <div className="summary-tab">
            <Summary stocks={stocks} />
          </div>
        )}
        {activeTab === 'table' && <StockTable stocks={stocks} />}
      </div>
    </div>
  );
}

export default Main; 