import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
// 새 프로젝트는 default database 사용
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
