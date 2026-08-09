import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, updateDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAB3HwQfyL32dYL473BG5_bUlGXk30p_-A",
  authDomain: "for-my-bebelabs.firebaseapp.com",
  projectId: "for-my-bebelabs",
  storageBucket: "for-my-bebelabs.firebasestorage.app",
  messagingSenderId: "526591033040",
  appId: "1:526591033040:web:50ac0a437a1fd9017168d5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const boardSize = 600; 
const docRef = doc(db, "games", "puzzleState");
const historyDocRef = doc(db, "games", "puzzleHistory");

let localState = null;
let currentGridSize = 4;
let playerName = localStorage.getItem('bebelabs_user') || "";

let activePiece = null;
let dragOffset = { x: 0, y: 0 };

// DOM Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const playerNameInput = document.getElementById('playerNameInput');
const enterGameBtn = document.getElementById('enterGameBtn');
const displayName = document.getElementById('displayName');
const leaveBtn = document.getElementById('leaveBtn');

const hintModal = document.getElementById('hintModal');
const hintImage = document.getElementById('hintImage');
const hintBtn = document.getElementById('hintBtn');
const closeHint = document.getElementById('closeHint');

const historyModal = document.getElementById('historyModal');
const historyStats = document.getElementById('historyStats');
const historyBtn = document.getElementById('historyBtn');
const closeHistory = document.getElementById('closeHistory');

const finishBtn = document.getElementById('finishBtn');
const uploadBtn = document.getElementById('uploadBtn');
const imageUpload = document.getElementById('imageUpload');
const resetBtn = document.getElementById('resetBtn');
const gridSelect = document.getElementById('gridSelect');
const board = document.getElementById('board');
const tray = document.getElementById('tray');
const gameStatus = document.getElementById('gameStatus');

// --- AUTH & USER SESSION PERSISTENCE ---
function initAuth() {
  if (playerName) {
    displayName.innerText = playerName;
    welcomeScreen.style.display = 'none';
  } else {
    welcomeScreen.style.display = 'flex';
  }

  enterGameBtn.addEventListener('click', () => {
    const val = playerNameInput.value.trim();
    if (val !== "") {
      playerName = val;
      localStorage.setItem('bebelabs_user', playerName);
      displayName.innerText = playerName;
      welcomeScreen.style.display = 'none';
    }
  });

  leaveBtn.addEventListener('click', () => {
    localStorage.removeItem('bebelabs_user');
    playerName = "";
    welcomeScreen.style.display = 'flex';
  });

  // Falling Hearts
  const items = ["💖", "💕", "❤️", "I Love Leigh", "Leigh ❤️", "Carlo ❤️"];
  const heartsContainer = document.getElementById('heartsContainer');
  for (let i = 0; i < 20; i++) {
    const item = document.createElement('div');
    item.className = 'falling-item';
    item.innerText = items[Math.floor(Math.random() * items.length)];
    item.style.left = `${Math.random() * 100}vw`;
    item.style.animationDuration = `${3 + Math.random() * 5}s`;
    item.style.animationDelay = `${Math.random() * 3}s`;
    item.style.fontSize = `${14 + Math.random() * 12}px`;
    heartsContainer.appendChild(item);
  }
}
initAuth();

// --- MODALS (HINT & HISTORY) ---
hintBtn.addEventListener('click', () => {
  if (localState && localState.imageUrl) {
    hintImage.src = localState.imageUrl;
    hintModal.style.display = 'flex';
  } else {
    alert("Upload a puzzle picture first!");
  }
});
closeHint.addEventListener('click', () => hintModal.style.display = 'none');

historyBtn.addEventListener('click', async () => {
  historyModal.style.display = 'flex';
  historyStats.innerHTML = "Fetching stats...";
  
  const snap = await getDoc(historyDocRef);
  if (snap.exists()) {
    const data = snap.data();
    historyStats.innerHTML = `
      <div class="rank-card"><h3>🌱 2x2 Beginner Rank:</h3> <p>Completed: <strong>${data['rank_2'] || 0}</strong></p></div>
      <div class="rank-card"><h3>🐣 3x3 Novice Rank:</h3> <p>Completed: <strong>${data['rank_3'] || 0}</strong></p></div>
      <div class="rank-card"><h3>⭐ 4x4 Intermediate Rank:</h3> <p>Completed: <strong>${data['rank_4'] || 0}</strong></p></div>
      <div class="rank-card"><h3>🔥 6x6 Advanced Rank:</h3> <p>Completed: <strong>${data['rank_6'] || 0}</strong></p></div>
      <div class="rank-card"><h3>👑 10x10 Master Rank:</h3> <p>Completed: <strong>${data['rank_10'] || 0}</strong></p></div>
    `;
  } else {
    historyStats.innerHTML = "<p>No puzzles completed yet. Be the first to finish one!</p>";
  }
});
closeHistory.addEventListener('click', () => historyModal.style.display = 'none');

// Image processing helper
function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 500;
        canvas.height = 500;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 500, 500);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setupBoard(gridSize) {
  board.innerHTML = '';
  board.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${gridSize}, 1fr)`;
  
  const totalSlots = gridSize * gridSize;
  for (let i = 0; i < totalSlots; i++) {
    const slot = document.createElement('div');
    slot.classList.add('slot');
    slot.dataset.index = i;
    board.appendChild(slot);
  }
  tray.innerHTML = '';
}
setupBoard(currentGridSize);

// --- DRAG ENGINE & POSITION SYNC ---
function makePieceDraggable(piece) {
  piece.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePiece = piece;
    piece.setPointerCapture(e.pointerId);
    
    const rect = piece.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;

    piece.classList.add('dragging');
    let tag = piece.querySelector('.player-tag') || document.createElement('div');
    tag.className = 'player-tag';
    tag.innerText = `Holding: ${playerName}`;
    piece.appendChild(tag);

    piece.style.position = 'fixed';
    piece.style.left = `${e.clientX - dragOffset.x}px`;
    piece.style.top = `${e.clientY - dragOffset.y}px`;
  });

  piece.addEventListener('pointermove', (e) => {
    if (!activePiece || activePiece !== piece) return;
    piece.style.left = `${e.clientX - dragOffset.x}px`;
    piece.style.top = `${e.clientY - dragOffset.y}px`;
  });

  piece.addEventListener('pointerup', async (e) => {
    if (!activePiece || activePiece !== piece) return;
    
    piece.releasePointerCapture(e.pointerId);
    piece.classList.remove('dragging');
    const tag = piece.querySelector('.player-tag');
    if (tag) tag.remove();

    piece.style.position = 'relative';
    piece.style.left = '0px';
    piece.style.top = '0px';

    piece.style.visibility = 'hidden';
    const dropElem = document.elementFromPoint(e.clientX, e.clientY);
    piece.style.visibility = 'visible';

    const slot = dropElem ? dropElem.closest('.slot') : null;
    const isOverTray = dropElem ? dropElem.closest('#tray') : null;

    let targetLocation = 'tray';
    if (slot) {
      targetLocation = `slot-${slot.dataset.index}`;
    } else if (isOverTray) {
      targetLocation = 'tray';
    } else {
      // Keep inside current slot or tray if dropped off-screen
      targetLocation = localState.pieces[piece.dataset.index] || 'tray';
    }

    activePiece = null;
    await updatePieceLocation(piece.dataset.index, targetLocation);
  });
}

function renderPieces(state) {
  if (!state || !state.imageUrl) return;
  if (activePiece) return;

  const gridSize = state.gridSize || 4;
  const totalPieces = gridSize * gridSize;
  const pieceSize = boardSize / gridSize;

  if (gridSelect.value != gridSize) gridSelect.value = gridSize;

  if (currentGridSize !== gridSize || board.children.length !== totalPieces) {
    currentGridSize = gridSize;
    setupBoard(gridSize);
  }

  if (document.querySelectorAll('.piece').length !== totalPieces) {
    tray.innerHTML = '';
    for (let i = 0; i < totalPieces; i++) {
      const piece = document.createElement('div');
      piece.classList.add('piece');
      piece.id = `piece-${i}`;
      piece.dataset.index = i;
      
      piece.style.width = `${pieceSize}px`;
      piece.style.height = `${pieceSize}px`;
      
      const row = Math.floor(i / gridSize);
      const col = i % gridSize;
      piece.style.backgroundImage = `url(${state.imageUrl})`;
      piece.style.backgroundSize = `${boardSize}px ${boardSize}px`;
      piece.style.backgroundPosition = `-${col * pieceSize}px -${row * pieceSize}px`;
      
      makePieceDraggable(piece);
      tray.appendChild(piece);
    }
  }

  // Update piece positions from database
  for (let i = 0; i < totalPieces; i++) {
    const piece = document.getElementById(`piece-${i}`);
    if (!piece) continue;

    const location = state.pieces ? state.pieces[i] : 'tray';
    if (location === 'tray' || !location) {
      tray.appendChild(piece);
    } else if (location.startsWith('slot-')) {
      const slotIndex = location.split('-')[1];
      const slot = document.querySelector(`.slot[data-index="${slotIndex}"]`);
      if (slot) slot.appendChild(piece);
    }
  }

  if (state.completed) {
    gameStatus.innerText = "🎉 Puzzle Completed & Logged in History! 🎉";
    gameStatus.style.color = "#4caf50";
  } else {
    gameStatus.innerText = "Drag pieces to solve, then click Finish Puzzle!";
    gameStatus.style.color = "#d81b60";
  }
}

async function updatePieceLocation(pieceIndex, targetLocation) {
  if (!localState || !localState.pieces) return;
  
  if (targetLocation.startsWith('slot-')) {
    const existingPieceIndex = Object.keys(localState.pieces).find(key => localState.pieces[key] === targetLocation);
    if (existingPieceIndex !== undefined && existingPieceIndex !== pieceIndex) {
      localState.pieces[existingPieceIndex] = 'tray'; 
    }
  }

  localState.pieces[pieceIndex] = targetLocation;
  await setDoc(docRef, { pieces: localState.pieces }, { merge: true });
}

// --- SUBMIT / FINISH PUZZLE LOGIC ---
finishBtn.addEventListener('click', async () => {
  if (!localState || !localState.pieces) return;
  
  const gridSize = localState.gridSize || 4;
  const totalPieces = gridSize * gridSize;
  let correctCount = 0;

  for (let i = 0; i < totalPieces; i++) {
    const loc = localState.pieces[i];
    if (loc === `slot-${i}`) correctCount++;
  }

  if (correctCount === totalPieces) {
    alert(`🎉 Congratulations ${playerName}! You correctly solved the ${gridSize}x${gridSize} puzzle!`);
    
    // Mark completed & increment rank history in database
    await setDoc(docRef, { completed: true }, { merge: true });
    
    const rankKey = `rank_${gridSize}`;
    try {
      await updateDoc(historyDocRef, { [rankKey]: increment(1) });
    } catch (e) {
      // Initialize document if missing
      await setDoc(historyDocRef, { [rankKey]: 1 }, { merge: true });
    }
  } else {
    alert(`❌ Puzzle is not finished yet! (${correctCount}/${totalPieces} pieces are in the correct place)`);
  }
});

// --- SHUFFLE & UPLOAD ---
uploadBtn.addEventListener('click', async () => {
  const file = imageUpload.files[0];
  if (!file) {
    alert("Please choose a picture first!");
    return;
  }
  
  const gridSize = parseInt(gridSelect.value);
  const totalPieces = gridSize * gridSize;

  gameStatus.innerText = "Creating randomized puzzle...";
  
  try {
    const dataUrl = await processImage(file);
    
    // Create array of randomized tray slots
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    
    await setDoc(docRef, {
      imageUrl: dataUrl,
      gridSize: gridSize,
      pieces: initialPieces,
      completed: false
    });
    
    document.querySelectorAll('.piece').forEach(p => p.remove());
    gameStatus.innerText = "Puzzle ready!";
  } catch (err) {
    alert("Error processing picture. Try another image.");
  }
});

resetBtn.addEventListener('click', async () => {
  if (localState && localState.gridSize) {
    const totalPieces = localState.gridSize * localState.gridSize;
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    await setDoc(docRef, { pieces: initialPieces, completed: false }, { merge: true });
  }
});

onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) {
    localState = docSnap.data();
    if (localState.imageUrl) renderPieces(localState);
  }
});
