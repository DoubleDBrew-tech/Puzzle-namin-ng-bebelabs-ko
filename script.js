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

// --- AUTH & PERSISTENCE ---
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

// --- MODALS ---
hintBtn.addEventListener('click', () => {
  if (localState && localState.imageUrl) {
    hintImage.src = localState.imageUrl;
    hintModal.style.display = 'flex';
  } else {
    gameStatus.innerText = "⚠️ Upload a puzzle picture first!";
  }
});
closeHint.addEventListener('click', () => hintModal.style.display = 'none');

historyBtn.addEventListener('click', async () => {
  historyModal.style.display = 'flex';
  historyStats.innerHTML = "Fetching history...";
  
  const snap = await getDoc(historyDocRef);
  if (snap.exists()) {
    const data = snap.data();
    historyStats.innerHTML = `
      <div class="rank-card"><h3>🌱 2x2 Beginner:</h3> <p>Completed: <strong>${data['rank_2'] || 0}</strong></p></div>
      <div class="rank-card"><h3>🐣 3x3 Novice:</h3> <p>Completed: <strong>${data['rank_3'] || 0}</strong></p></div>
      <div class="rank-card"><h3>⭐ 4x4 Intermediate:</h3> <p>Completed: <strong>${data['rank_4'] || 0}</strong></p></div>
      <div class="rank-card"><h3>🔥 6x6 Advanced:</h3> <p>Completed: <strong>${data['rank_6'] || 0}</strong></p></div>
      <div class="rank-card"><h3>👑 10x10 Master:</h3> <p>Completed: <strong>${data['rank_10'] || 0}</strong></p></div>
    `;
  } else {
    historyStats.innerHTML = "<p>No puzzles completed yet!</p>";
  }
});
closeHistory.addEventListener('click', () => historyModal.style.display = 'none');

// Image processor
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

// Fisher-Yates shuffle generator
function generateShuffledOrder(total) {
  const arr = Array.from({ length: total }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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

// --- DRAG ENGINE & REAL-TIME SYNC ---
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
      targetLocation = localState.pieces[piece.dataset.index] || 'tray';
    }

    activePiece = null;
    await updatePieceLocation(piece.dataset.index, targetLocation);
  });
}

// Render pieces using deterministic trayOrder from Firebase
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

  // Create pieces if DOM count mismatches
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

  // Position pieces on board or inside tray following state.trayOrder
  const trayOrder = state.trayOrder || Array.from({ length: totalPieces }, (_, i) => i);
  
  // Clear tray to re-render in correct order
  tray.innerHTML = '';
  
  // 1. First append tray pieces in shuffled order
  trayOrder.forEach((pieceIdx) => {
    const piece = document.getElementById(`piece-${pieceIdx}`);
    if (!piece) return;
    const loc = state.pieces ? state.pieces[pieceIdx] : 'tray';
    if (loc === 'tray' || !loc) {
      tray.appendChild(piece);
    }
  });

  // 2. Append board pieces to their respective slots
  for (let i = 0; i < totalPieces; i++) {
    const piece = document.getElementById(`piece-${i}`);
    if (!piece) continue;
    const loc = state.pieces ? state.pieces[i] : 'tray';
    if (loc && loc.startsWith('slot-')) {
      const slotIndex = loc.split('-')[1];
      const slot = document.querySelector(`.slot[data-index="${slotIndex}"]`);
      if (slot) slot.appendChild(piece);
    }
  }

  if (state.completed) {
    board.classList.add('celebrate-win');
    gameStatus.innerText = state.winnerText || "🎉 Puzzle Complete!";
    gameStatus.style.color = "#4caf50";
  } else {
    board.classList.remove('celebrate-win', 'shake-error');
    gameStatus.innerText = "Drag randomized pieces to solve, then click Finish Puzzle!";
    gameStatus.style.color = "#d81b60";
  }
}

async function updatePieceLocation(pieceIndex, targetLocation) {
  if (!localState || !localState.pieces) return;
  
  localState.placedBy = localState.placedBy || {};

  if (targetLocation.startsWith('slot-')) {
    // If a piece already exists in that slot, send it back to tray
    const existingPieceIndex = Object.keys(localState.pieces).find(key => localState.pieces[key] === targetLocation);
    if (existingPieceIndex !== undefined && existingPieceIndex !== pieceIndex) {
      localState.pieces[existingPieceIndex] = 'tray'; 
      delete localState.placedBy[existingPieceIndex];
    }
    // Record who placed this piece
    localState.placedBy[pieceIndex] = playerName;
  } else {
    delete localState.placedBy[pieceIndex];
  }

  localState.pieces[pieceIndex] = targetLocation;
  await setDoc(docRef, { pieces: localState.pieces, placedBy: localState.placedBy }, { merge: true });
}

// Trigger celebratory particle explosion
function triggerCelebration() {
  const overlay = document.getElementById('celebrationOverlay');
  overlay.innerHTML = '';
  const emojis = ['🏆', '💖', '⭐', '🎉', '👑', '❤️', '✨'];
  
  for (let i = 0; i < 40; i++) {
    const item = document.createElement('div');
    item.className = 'celebration-item';
    item.innerText = emojis[Math.floor(Math.random() * emojis.length)];
    item.style.left = '50vw';
    item.style.top = '50vh';
    
    const angle = Math.random() * Math.PI * 2;
    const dist = 150 + Math.random() * 350;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist;
    const rot = Math.random() * 720;
    
    item.style.setProperty('--tx', `${tx}px`);
    item.style.setProperty('--ty', `${ty}px`);
    item.style.setProperty('--rot', `${rot}deg`);
    
    overlay.appendChild(item);
  }
  
  setTimeout(() => overlay.innerHTML = '', 2500);
}

// --- SUBMIT / FINISH PUZZLE LOGIC ---
finishBtn.addEventListener('click', async () => {
  if (!localState || !localState.pieces) return;
  
  const gridSize = localState.gridSize || 4;
  const totalPieces = gridSize * gridSize;
  let correctCount = 0;

  for (let i = 0; i < totalPieces; i++) {
    if (localState.pieces[i] === `slot-${i}`) {
      correctCount++;
    }
  }

  if (correctCount === totalPieces) {
    // Tally correct placements per player
    const tally = {};
    const placedBy = localState.placedBy || {};
    
    for (let i = 0; i < totalPieces; i++) {
      const author = placedBy[i] || "Anonymous";
      tally[author] = (tally[author] || 0) + 1;
    }

    // Determine winner/MVP
    let topPlayer = "";
    let maxPlaced = -1;
    let isTie = false;

    Object.entries(tally).forEach(([player, count]) => {
      if (count > maxPlaced) {
        maxPlaced = count;
        topPlayer = player;
        isTie = false;
      } else if (count === maxPlaced) {
        isTie = true;
      }
    });

    let winnerMsg = "";
    if (isTie) {
      winnerMsg = `🎉 Complete! It's a tie! Both placed equal pieces. ❤️`;
    } else {
      winnerMsg = `🎉 Complete! ${topPlayer} placed the most pieces (${maxPlaced}/${totalPieces})! 👑`;
    }

    triggerCelebration();

    await setDoc(docRef, { 
      completed: true, 
      winnerText: winnerMsg 
    }, { merge: true });
    
    const rankKey = `rank_${gridSize}`;
    try {
      await updateDoc(historyDocRef, { [rankKey]: increment(1) });
    } catch (e) {
      await setDoc(historyDocRef, { [rankKey]: 1 }, { merge: true });
    }

  } else {
    // Vibrate/Shake board on error
    board.classList.remove('shake-error');
    void board.offsetWidth; // Force CSS reflow
    board.classList.add('shake-error');

    gameStatus.innerText = `❌ Incorrect! (${correctCount}/${totalPieces} pieces are in the right spot)`;
    gameStatus.style.color = "#f44336";

    setTimeout(() => board.classList.remove('shake-error'), 600);
  }
});

// --- SHUFFLE & UPLOAD ---
uploadBtn.addEventListener('click', async () => {
  const file = imageUpload.files[0];
  if (!file) {
    gameStatus.innerText = "⚠️ Please select a picture first!";
    return;
  }
  
  const gridSize = parseInt(gridSelect.value);
  const totalPieces = gridSize * gridSize;

  gameStatus.innerText = "Processing & shuffling picture...";
  
  try {
    const dataUrl = await processImage(file);
    const trayOrder = generateShuffledOrder(totalPieces);
    
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    
    await setDoc(docRef, {
      imageUrl: dataUrl,
      gridSize: gridSize,
      pieces: initialPieces,
      trayOrder: trayOrder,
      placedBy: {},
      completed: false,
      winnerText: ""
    });
    
    document.querySelectorAll('.piece').forEach(p => p.remove());
    gameStatus.innerText = "Puzzle ready!";
  } catch (err) {
    gameStatus.innerText = "Error processing image. Try another photo.";
  }
});

resetBtn.addEventListener('click', async () => {
  if (localState && localState.gridSize) {
    const totalPieces = localState.gridSize * localState.gridSize;
    const trayOrder = generateShuffledOrder(totalPieces);
    
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    await setDoc(docRef, { 
      pieces: initialPieces, 
      trayOrder: trayOrder,
      placedBy: {}, 
      completed: false,
      winnerText: ""
    }, { merge: true });
  }
});

// Real-time listener
onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) {
    localState = docSnap.data();
    if (localState.imageUrl) renderPieces(localState);
  }
});
