import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

let localState = null;
let currentGridSize = 4;
let playerName = "Player";

// Drag state tracking
let activePiece = null;
let dragOffset = { x: 0, y: 0 };

// UI Elements
const welcomeScreen = document.getElementById('welcomeScreen');
const playerNameInput = document.getElementById('playerNameInput');
const enterGameBtn = document.getElementById('enterGameBtn');
const heartsContainer = document.getElementById('heartsContainer');

const uploadBtn = document.getElementById('uploadBtn');
const imageUpload = document.getElementById('imageUpload');
const resetBtn = document.getElementById('resetBtn');
const gridSelect = document.getElementById('gridSelect');
const board = document.getElementById('board');
const tray = document.getElementById('tray');
const gameStatus = document.getElementById('gameStatus');

// --- WELCOME SCREEN & HEARTS ANIMATION ---
function initWelcomeScreen() {
  // Create falling hearts & text
  const items = ["💖", "💕", "❤️", "I Love Leigh", "Leigh ❤️", " Carlo ❤️"];
  for (let i = 0; i < 25; i++) {
    const item = document.createElement('div');
    item.className = 'falling-item';
    item.innerText = items[Math.floor(Math.random() * items.length)];
    item.style.left = `${Math.random() * 100}vw`;
    item.style.animationDuration = `${3 + Math.random() * 5}s`;
    item.style.animationDelay = `${Math.random() * 3}s`;
    item.style.fontSize = `${14 + Math.random() * 12}px`;
    heartsContainer.appendChild(item);
  }

  enterGameBtn.addEventListener('click', () => {
    const inputVal = playerNameInput.value.trim();
    if (inputVal !== "") playerName = inputVal;
    welcomeScreen.style.display = 'none';
  });
}

initWelcomeScreen();

// Grid selector listener
gridSelect.addEventListener('change', () => {
  setupBoard(parseInt(gridSelect.value));
});

// Image process helper
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
      img.onerror = () => reject("Failed to process image.");
      img.src = e.target.result;
    };
    reader.onerror = () => reject("Failed to read file.");
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

// --- TOUCH & MOUSE POINTER DRAG ENGINE ---
function makePieceDraggable(piece) {
  piece.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    activePiece = piece;
    
    // Set pointer capture for smooth tracking on iPad
    piece.setPointerCapture(e.pointerId);
    
    const rect = piece.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;

    piece.classList.add('dragging');
    
    // Attach Player Name Badge while dragging
    let tag = piece.querySelector('.player-tag');
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'player-tag';
      piece.appendChild(tag);
    }
    tag.innerText = `Holding: ${playerName}`;

    // Move piece to fixed positioning overlay while dragging
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
    
    // Remove Name Badge tag
    const tag = piece.querySelector('.player-tag');
    if (tag) tag.remove();

    piece.style.position = 'relative';
    piece.style.left = '0px';
    piece.style.top = '0px';

    // Find drop target under current finger/mouse location
    piece.style.visibility = 'hidden';
    const dropElem = document.elementFromPoint(e.clientX, e.clientY);
    piece.style.visibility = 'visible';

    const slot = dropElem ? dropElem.closest('.slot') : null;
    const isOverTray = dropElem ? dropElem.closest('#tray') : null;

    let targetLocation = 'tray';
    if (slot) {
      targetLocation = `slot-${slot.dataset.index}`;
    } else if (!isOverTray) {
      targetLocation = 'tray'; // Default back to tray if dropped outside
    }

    activePiece = null;
    await updatePieceLocation(piece.dataset.index, targetLocation);
  });
}

// Render puzzle state
function renderPieces(state) {
  if (!state || !state.imageUrl) return;
  if (activePiece) return; // Prevent re-render glitches while user is actively dragging

  const gridSize = state.gridSize || 4;
  const totalPieces = gridSize * gridSize;
  const pieceSize = boardSize / gridSize;

  if (gridSelect.value != gridSize) {
    gridSelect.value = gridSize;
  }

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

  // Update piece positions from Firestore
  let correctCount = 0;
  for (let i = 0; i < totalPieces; i++) {
    const piece = document.getElementById(`piece-${i}`);
    if (!piece) continue;

    const location = state.pieces ? state.pieces[i] : 'tray';
    if (location === 'tray' || !location) {
      tray.appendChild(piece);
    } else if (location.startsWith('slot-')) {
      const slotIndex = location.split('-')[1];
      const slot = document.querySelector(`.slot[data-index="${slotIndex}"]`);
      if (slot) {
        slot.appendChild(piece);
        if (slotIndex == i) correctCount++;
      }
    }
  }

  checkWinCondition(correctCount, totalPieces);
}

function checkWinCondition(correctCount, total) {
  if (correctCount === total && total > 0) {
    gameStatus.innerText = "🎉 Puzzle Complete! Perfect job! 🎉";
    gameStatus.style.color = "#4caf50";
  } else {
    gameStatus.innerText = `Solving puzzle (${correctCount}/${total} pieces placed correctly)`;
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

// Upload picture handler
uploadBtn.addEventListener('click', async () => {
  const file = imageUpload.files[0];
  if (!file) {
    alert("Please choose a picture first!");
    return;
  }
  
  const gridSize = parseInt(gridSelect.value);
  const totalPieces = gridSize * gridSize;

  gameStatus.innerText = "Creating puzzle pieces...";
  
  try {
    const dataUrl = await processImage(file);
    
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    
    await setDoc(docRef, {
      imageUrl: dataUrl,
      gridSize: gridSize,
      pieces: initialPieces
    });
    
    document.querySelectorAll('.piece').forEach(p => p.remove());
    gameStatus.innerText = "Puzzle ready! Touch and drag pieces to solve.";
  } catch (err) {
    console.error(err);
    alert("Could not process picture. Try another photo.");
  }
});

// Reset puzzle handler
resetBtn.addEventListener('click', async () => {
  if (localState && localState.gridSize) {
    const totalPieces = localState.gridSize * localState.gridSize;
    const initialPieces = {};
    for (let i = 0; i < totalPieces; i++) {
      initialPieces[i] = 'tray';
    }
    await setDoc(docRef, { pieces: initialPieces }, { merge: true });
  }
});

// Real-time Firestore sync
onSnapshot(docRef, (docSnap) => {
  if (docSnap.exists()) {
    localState = docSnap.data();
    if (localState.imageUrl) {
      renderPieces(localState);
    }
  }
});
