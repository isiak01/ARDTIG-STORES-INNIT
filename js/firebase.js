import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore, doc, getDoc, collection, query, where, limit, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction, onSnapshot, orderBy, increment, arrayUnion, arrayRemove, writeBatch } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

let client;

export async function getFirebase() {
  if (client) return client;
  const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
  const config = await response.json();
  if (!response.ok || !config.firebase) {
    throw new Error(config.error || 'Firebase web configuration is incomplete.');
  }
  const app = initializeApp(config.firebase);
  client = {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    provider: new GoogleAuthProvider(),
    onAuthStateChanged,
    signInWithPopup,
    signOut,
    doc,
    getDoc,
    collection,
    query,
    where,
    limit,
    getDocs,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    serverTimestamp,
    runTransaction,
    onSnapshot,
    orderBy,
    increment,
    arrayUnion,
    arrayRemove,
    writeBatch,
  };
  return client;
}

export async function currentUser() {
  const { auth, onAuthStateChanged: listen } = await getFirebase();
  return new Promise((resolve, reject) => {
    const unsubscribe = listen(auth, (user) => {
      unsubscribe();
      resolve(user);
    }, reject);
  });
}

export async function idToken() {
  const user = await currentUser();
  if (!user) throw new Error('Sign in to continue.');
  return user.getIdToken();
}
