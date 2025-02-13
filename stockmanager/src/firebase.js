import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
const firebaseConfig = {
  apiKey: "AIzaSyAh0Zhxt_sAbAtMeW_gb0-QOaT1u7KHZH8",
  authDomain: "visualp-1.firebaseapp.com",
  databaseURL: "https://visualp-1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "visualp-1",
  storageBucket: "visualp-1.firebasestorage.app",
  messagingSenderId: "659233295218",
  appId: "1:659233295218:web:bc8889bbdcd00a4f372beb",
  measurementId: "G-T34PEL0VS4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app); 
export const database = getDatabase(app);