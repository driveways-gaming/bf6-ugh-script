// === Zombies.ts ===
//import * as modlib from 'modlib';
//import { ParseUI } from "modlib";
const VERSION = [1, 0, 8];
const ZEROVEC = mod.CreateVector(0,0,0)
// Object ID System: XYY format
// X = Object Type (1=Spawner, 2=InteractPoint, 3=WorldIcon, 4=Debris Interacts, 5=Debris Spatial, 6=Debris WorldIcon, 7=PaP)
// YY = Individual ID (01-99)
// 4XX = Debris InteractPoints
// 5XX = Debris SpatialObjects (barriers to delete)
// 6XX = Debris WorldIcons
// 7XX = PaP Interact/Icon
// Debris System Configuration
// ============================================
// --- GLOBAL RELOAD TRACKING ---
// ============================================

// Tracks the reloading state for every player in the match
const playerReloadTracking: {[key: number]: {
    isCurrentlyReloading: boolean;
    // NEW FLAG: True if reload starts with 0 ammo
    isPerformingEmptyReload: boolean;
}} = {};
// ============================================
// -- Global Class stuff --
// ============================================
const SECONDARY_WEAPON_SLOT = mod.InventorySlots.SecondaryWeapon; // Slot to target
const FIRE_DECREMENT_DELAY = 0.05; 
const SOLDIER_IS_RELOADING = mod.SoldierStateBool.IsReloading; 
const SOLDIER_IS_FIRING = mod.SoldierStateBool.IsFiring;
// ============================================
// --- SUPPORT CLASS AMMO BONUS CONFIG ---
// ============================================
const SUPPORT_MAX_HEALTH = 250;
// Define the class and separate state map
const SUPPORT_CLASS = mod.SoldierClass.Support;
const ENGINEER_CLASS = mod.SoldierClass.Engineer;

// New state interface/type (only tracks what the Support class needs)
interface SupportState {
    playerId: number;
    extraRounds: number;
    lastFiredBonusTime: number;
    maxMagAmmo: number; // Max magazine capacity of secondary
    ammoCountLastTick: number; // <--- NEW PROPERTY
}

// New global map to store the Support class states
const supportStates: {[key: number]: SupportState} = {};
// ============================================
// --- SUPPORT REGEN: SELF-HEAL CONSTANTS ---
// ============================================
const SUPPORT_SELF_REGEN_THRESHOLD = 0.36; // 36% max HP
const SUPPORT_SELF_REGEN_AMOUNT = 2;       // 2 HP healed
const SUPPORT_SELF_HEAL_COOLDOWN = 5.0;    // 5 seconds between heals
const SUPPORT_SELF_DAMAGE_COOLDOWN = 5.0;  // 5 seconds delay after damage

// ============================================
// --- SUPPORT REGEN: AURA-HEAL CONSTANTS ---
// ============================================
const SUPPORT_AURA_RANGE = 5.0;            // 5 meters
const SUPPORT_AURA_BASE_REGEN = 0.5;       // 0.5 HP healed
const SUPPORT_AURA_HEAL_COOLDOWN = 2.0;    // 2 seconds between heals
const SUPPORT_AURA_DAMAGE_COOLDOWN = 2.0;  // 2 seconds delay after damage
const SUPPORT_STACK_MULTIPLIER = 1.3;      // 1 + 0.3 = 1.3 (30% increase)
// --- GLOBAL CONSTANT FOR SQUARED RANGE ---
// This should be defined once at the top of your script alongside other constants.
const SUPPORT_AURA_RANGE_SQ = SUPPORT_AURA_RANGE * SUPPORT_AURA_RANGE;

// Global map to track regeneration state (Shared by both systems)
const playerRegenTracking: { [key: number]: {
    lastHealTime: number; 
    lastDamageTime: number; 
    previousHealth: number;
    fractionalHealAccumulator: number; // NEW: Accumulator for fractional regeneration amounts
} } = {};
// ============================================
// === ENGINEER SYSTEM CONFIGURATION ===
const ENGINEER_MAX_HEALTH = 400;

// Overheat Constants
const ENGINEER_MAX_OVERHEAT = 10.0;     // Max overheat time in seconds
const AMMO_REPLENISH_PERCENT = 0.15;    // 15% magazine replenished
const AMMO_REPLENISH_INTERVAL = 2.0;    // Replenish every 2 seconds
const COOL_DOWN_DELAY = 4.0;            // 2 Seconds of no-fire before cooling begins
const COOL_DOWN_INCREMENT_INTERVAL = 0.75; // Increment COOL_DOWN_INCREMENT_AMOUNT every 1 second
const COOL_DOWN_INCREMENT_AMOUNT = 1.0; // Increment ENGINEER_MAX_OVERHEAT timer by 0.5s
const OVERHEAT_LOCKOUT_TIME = 5.0;      // Seconds locked when overheated

// Engineer State Storage
interface EngineerState {
    playerId: number;
    overheatTimer: number; // Starts at 10.0, counts down to 0.0
    isOverheated: boolean;
    lastFiredTime: number; // For the 2s no-fire delay check
    lastReplenishTime: number;
    lastIncrementTime: number;
    lockoutEndTime: number; // Time when overheat lockout ends
    maxMagAmmo: number; // Secondary weapon max magazine capacity
}
let engineerStates: { [id: number]: EngineerState } = {};
// =======================================
// === ENGINEER UI CONFIGURATION ===
// === ENGINEER UI WIDGET NAMES (Adjust if necessary) ===
const UI_WIDGET_GROUP_NAME = "Engineer_Overheat_Container"; 
const UI_BAR_IMAGE_NAME = "Overheat_Bar_Image"; 
const UI_STATUS_LABEL_NAME = "Overheat_Status_Label";

// Colors (Now defined as the [R, G, B] array used by mod.CreateVector)
// NOTE: These are normalized 0-1.0. Adjust if your engine uses 0-255.
const COLOR_RED_ARRAY = [1.0, 0.0, 0.0];       
const COLOR_ORANGE_ARRAY = [1.0, 0.6, 0.0];    
const COLOR_GREEN_ARRAY = [0.0, 1.0, 0.0];
// =================================
// === MAX SPECIALS CONFIGURATION ===
const MAX_ALIVE_SPECIALS = 4; // Sets the total number of Smoker + Hunter zombies allowed
let specialsAlive = 0;        // Tracks the current total number of specials alive
// ==================================
// === GLOBAL PLAYER STATE ===
// Tracks players currently locked by a special infected (Smoker pull or Hunter pounce)
let disabledPlayerIds: Set<number> = new Set();
// === HUNTER CONFIGURATION & STATE ===
const HUNTER_CLOSE_RANGE = 8.0; // Meters: hunter battlefield range
const HUNTER_SPAWN_CHANCE = 0.25; // 25% chance to spawn
const MAX_ALIVE_HUNTERS = 3; // Max concurrent Hunters, 3
let huntersAlive = 0;
let hunterZombieIds: Set<number> = new Set();

// Pounce Cooldown
const HUNTER_POUNCE_COOLDOWN_SECONDS = 30; // 1.5 minutes
let isHunterPounceOnCooldown: boolean = false;
let hunterPounceCooldownEndTime: number = 0;

// Pounce Attack Logic
const HUNTER_POUNCE_CHECK_INTERVAL = 2.0; // Checks every 2 seconds
const HUNTER_POUNCE_TRIGGER_CHANCE = 0.15; // 15% chance on check
const HUNTER_POUNCE_RANGE_2D = 8.0; // 8 meters (ignoring height)
const HUNTER_POUNCE_PIN_RANGE = 0.5; // 2.5 meters to connect
const HUNTER_POUNCE_WINDUP_SECONDS = 3.0; // 3 second crouch
const HUNTER_POUNCE_LEAP_DURATION = 0.4; // FIX: Changed from 1.0s to 0.4s for snappier jump
const HUNTER_POUNCE_MAX_LEAP_DISTANCE = 12.0; // NEW: Used to project the leap outward for a better arc/reach
let hunterLastPounceCheckTime: number = 0;

// Pounce State Machine: Tracks what each Hunter is doing
// 'stalking': Crouched, preparing to leap
// 'leaping': Flying through the air
// 'pinned': Actively damaging a player
type HunterState = 'idle' | 'stalking' | 'leaping' | 'pinned';
let hunterPounceStates: {[hunterId: number]: { 
    state: HunterState, 
    targetId: number, 
    startTime: number, 
    leapTargetPos: mod.Vector 
}} = {};

// Global Pounce Lock (Only one pounce active at a time)
let isHunterPounceActive: boolean = false; 
let hunterPouncerId: number = 0;
let pouncedPlayerId: number = 0;

// Pinned Damage Loop
const HUNTER_POUNCE_DAMAGE = 18;
const HUNTER_POUNCE_DAMAGE_INTERVAL = 0.5; // 500ms
const POUNCE_MOVE_TIME = 0.5
let hunterPounceLastDamageTime: number = 0;

// =======================================
// === SMOKER COOLDOWN CONFIGURATION & STATE ===
let ZombieName = mod.Message("")
//let smokerRespawnCooldownTimer: number | null = null; // Stores the timer handle
let isSmokerOnCooldown: boolean = false;
let smokerCooldownStartTime: number = 0; // NEW: Time in seconds when cooldown started
let smokerCooldownEndTime: number = 0;   // NEW: Time in seconds when cooldown ends
// === SMOKER DAMAGE DETECTION CONSTANTS ===
const SMOKER_PULL_DAMAGE_CHEST = 16;    // Original damage value (e.g., chest hit)
const SMOKER_PULL_DAMAGE_BODY = 12.8;     // New damage value (e.g., limb/body hit)
const SMOKER_PULL_RANGE = 40.0;         // Max distance (meters) a Smoker can be to initiate the pull
// ==============================================
// === NEW SMOKER PULL CONFIGURATION & STATE ===
const SMOKER_PULL_DAMAGE = 15;        // Damage dealt every 0.75 seconds
const PULL_DURATION_SECONDS = 0.75;   // The fixed interval for damage and pull
const PULL_MOVE_TIME = 2.5;           // How long the mod.MoveObject command takes (shorter than interval)
// State Variables (Track the active pull)
let smokerPullActive: boolean = false; // <<< DECLARED HERE
let smokerPullerId: number = 0;
let pulledPlayerId: number = 0;
let smokerLastPullTime: number = 0;   // <<< NEW: Tracks when the last pull action occurred
let lastPulledPlayerId: number = 0; // ID of the player who was last pulled (used for immunity check)
// ==============================================
// === SMOKER PULL GRACE PERIOD CONFIGURATION ===
const SMOKER_GRACE_PERIOD_SECONDS = 5.0; // 1.5 seconds to prevent immediate re-grab
let smokerPullGracePeriodEndTime: number = 0; // Tracks when the grace period ends
// ==============================================
// === AMMO COOLDOWN CONFIGURATION & STATE ===
const SMOKER_AMMO_COOLDOWN_SECONDS = 10; // The 10-second delay
let smokerAmmoCooldownEndTime: number = 0; // Time when ammo is restored
let smokerIdAwaitingAmmo: number = 0; // ID of the specific Smoker waiting for ammo
// ==========================================
const SMOKER_CLOSE_RANGE = 15.0; // Meters: Smokers use this range to stop and start shooting. <--- NEW
const SMOKER_SPAWN_CHANCE = 0.30; // 5% chance //30%
const MAX_ALIVE_SMOKERS = 4; // Only one Smoker at a time, 4
let smokersAlive = 0;
let smokerZombieIds: Set<number> = new Set();
let ZOMBIE_CLOSE_RANGE = 5.0; // Meters: If a player is within this distance, use standard bot AI.
const ZOMBIE_MAX_AI_BASE = 24; // Base max zombies before multipliers
const ZOMBIE_AI_PER_PLAYER = 6; // Base zombies added per player
let zombieLastDamageTime: {[key: number]: number} = {};
let zombieLastPosition: {[key: number]: mod.Vector} = {};
const ZOMBIE_STUCK_TIMEOUT = 20; // seconds
const ZOMBIE_MOVE_THRESHOLD = 2.0; // meters - if zombie hasn't moved this far, consider stuck
const MAX_AMMO_EVENT_ROUNDS = 5; // Every 5 rounds
const MAX_AMMO_ZOMBIE_COUNT = 20; // Number of special zombies to spawn
const MAX_AMMO_ZOMBIE_HEALTH = 50; // Low HP
const MAX_AMMO_ZOMBIE_DAMAGE = 10; // Low damage
const ZOMBIE_SLAP_DAMAGE = 10; //52
const ZOMBIE_SLAP_WINDUP_TIME = 0.6; //0.8
const ZOMBIE_SLAP_COOLDOWN = 1; // 0.3 seconds between slaps
const ZOMBIE_SLAP_RANGE = 2.5; // 2.5 meters
// --- NEW ZOMBIE LEAP CONFIG ---
//const ZOMBIE_LEAP_MIN_Y_DIFFERENCE = 3.0; // Min 3 meters vertical height to trigger
//const ZOMBIE_LEAP_MAX_XZ_DISTANCE = 8.0;  // Max 4 meters horizontal distance
// --- NEW ZOMBIE LEAP TIER CONFIG ---
// Defines the horizontal (XZ) leap limit based on the player's vertical (Y) height.
// Tiers are checked from top to bottom (highest minHeight first).
const ZOMBIE_LEAP_TIERS= [
    
    // Example: Rooftops (Player is 8.1m to 20m high)
    // Allows zombies to leap a generous 10m horizontally to get onto a roof.
    { minHeight: 30.0, maxHeight: 999999,  horizontalLimit: 50.0, duration: 5.00, windupDelay: 4.75, boostDuration: 1.25},

    { minHeight: 18.0, maxHeight: 50.0,  horizontalLimit: 30.0, duration: 4.25, windupDelay: 4.00, boostDuration: 5.25},

    { minHeight: 14.0, maxHeight: 40.0,  horizontalLimit: 25.0, duration: 3.50, windupDelay: 3.75, boostDuration: 4.25},

    { minHeight: 12.0, maxHeight: 30.0,  horizontalLimit: 20.0, duration: 2.50, windupDelay: 2.75, boostDuration: 3.85},

    { minHeight: 10.1, maxHeight: 25.0, horizontalLimit: 15.0, duration: 2.25, windupDelay: 2.35, boostDuration: 3.55},

    { minHeight: 9.0, maxHeight: 20.0,  horizontalLimit: 12.0, duration: 1.55, windupDelay: 1.85, boostDuration: 2.50},

    { minHeight: 8.1, maxHeight: 18.0,  horizontalLimit: 10.0, duration: 1.25, windupDelay: 1.55, boostDuration: 2.15},

    { minHeight: 6.0, maxHeight: 15.0,  horizontalLimit: 8.0, duration: 1.00, windupDelay: 1.35, boostDuration: 2.05},

    { minHeight: 5.0, maxHeight: 12.0,  horizontalLimit: 6.0, duration: 0.75, windupDelay: 1.05, boostDuration: 1.65},
    
    // Your Original Logic: Ledges (Player is 3m to 8m high)
    // Zombies must be very close (4m horizontally) to jump up.
    { minHeight: 3.0, maxHeight: 8.0,  horizontalLimit: 4.0, duration: 0.5, windupDelay: 0.75, boostDuration: 1.25}

    // To add more, just copy a line:
    // { minHeight: 20.1, maxHeight: 50.0, horizontalLimit: 15.0 },
];
// --------------------------------
const ZOMBIE_LEAP_COOLDOWN = 10.0;        // 10 second cooldown per zombie

// --- NEW ZOMBIE BOOST CONFIG ---
const ZOMBIE_BOOST_COOLDOWN = 5.0;        // A shorter 5-second utility cooldown
// --------------------------------

type ZombieSlapState = {
    targetPlayerId: number;
    windupStartTime: number;
    hasWarned: boolean;
};
let zombieSlapCooldowns: {[zombieId: number]: number} = {};
let zombieSlapWindups: {[zombieId: number]: ZombieSlapState} = {};
let zombieLeapCooldowns: {[zombieId: number]: number} = {}; // <-- ADD THIS LINE
let zombieBoostCooldowns: {[zombieId: number]: number} = {}; // <-- ADD THIS LINE
let zombieLeapWindups: {[zombieId: number]: { // <-- ADD THIS
    targetPos: mod.Vector; // The fixed position the player was in when windup started
    executeTime: number;   // The game time when the leap must be executed
    duration: number;      // The duration of the SetObjectTransformOverTime move
    isBoost: boolean;      // Flag to track if this is a leap or a boost move
}} = {};
// === NEW TYPE DEFINITION ===
type ZombieLeapTier = {
    minHeight: number;
    maxHeight: number;
    horizontalLimit: number;
    duration: number; // Required
    windupDelay: number; // Required
    boostDuration: number; // <-- NEW: Required for the slow climb
}
// ============================================
// --- NEW: L4D2 SHOVE/STAMINA SYSTEM ---
// ============================================
// === NEW TYPE DEFINITION ===
type ShoveStats = {
    maxStamina: number;
    regenDelay: number;
    knockdownChance: number;
    pushbackDistance: number;
    pushbackDuration: number;
    stunDuration: number;
    knockdownStunMultiplier: number; // Replaces the old multiplier constant
    meleeDamageTrigger: number; // <--- NEW STAT ADDED
}
// --- Configuration ---
// ============================================
// --- CLASS-BASED SHOVE STATS CONFIG ---
// ============================================

// 1. Default stats for any class not listed (e.g., Support, Assault)
const DEFAULT_SHOVE_STATS: ShoveStats = {
    maxStamina: 5.0,
    regenDelay: 5.0,
    knockdownChance: 0.15,
    pushbackDistance: 3.0,
    pushbackDuration: 0.3,
    stunDuration: 1.00,
    knockdownStunMultiplier: 2.0,
    meleeDamageTrigger: 35, // <--- NEW STAT ADDED
};

// 2. Engineer-specific stats (based on your example)
const ENGINEER_SHOVE_STATS: ShoveStats = {
    maxStamina: 8.0,
    regenDelay: 10.0, //10
    knockdownChance: 0.50,
    pushbackDistance: 6.0,
    pushbackDuration: 1.0,
    stunDuration: 2.5, // Note: You said 2.50s in your example
    knockdownStunMultiplier: 2.0, // (This is from your previous code)
    meleeDamageTrigger: 60, // <--- NEW STAT ADDED
};

// 3. Assault-specific stats (based on your example)
const ASSAULT_SHOVE_STATS: ShoveStats = {
    maxStamina: 3.0,
    regenDelay: 2.75, //2.75
    knockdownChance: 0.25,
    pushbackDistance: 1.8,
    pushbackDuration: 0.15,
    stunDuration: 0.75,
    knockdownStunMultiplier: 2.0,
    meleeDamageTrigger: 35, // <--- NEW STAT ADDED
};

// 4. Recon-specific stats (based on your example)
const RECON_SHOVE_STATS: ShoveStats = {
    maxStamina: 7.0,
    regenDelay: 5.5,
    knockdownChance: 0.08,
    pushbackDistance: 4.0,
    pushbackDuration: 0.5,
    stunDuration: 1.25,
    knockdownStunMultiplier: 2.5,
    meleeDamageTrigger: 35, // <--- NEW STAT ADDED
};

// 3. The main lookup map
const CLASS_SHOVE_STATS = {
    [mod.SoldierClass.Engineer]: ENGINEER_SHOVE_STATS,
    [mod.SoldierClass.Support]: DEFAULT_SHOVE_STATS, // Example: Support uses default
    [mod.SoldierClass.Assault]: ASSAULT_SHOVE_STATS, // Example: Assault uses default
    [mod.SoldierClass.Recon]: RECON_SHOVE_STATS   // Example: Recon uses default
};
// ============================================
const SHOVE_RADIUS = 3.5; //2.56
const SHOVE_RADIUS_SQ = SHOVE_RADIUS * SHOVE_RADIUS; // Optimized for distance checks
const SHOVE_FACING_DOT_PRODUCT = 0.707; // Cosine of 60 degrees (120-degree cone). 0.0 = 180 degrees. 0.5

// Melee damage value used as the trigger for a successful shove.
const SHOVE_MELEE_DAMAGE = 35; // <-- NEW DAMAGE CONSTANT

// --- Global State Tracking ---
interface ShoveState {
    currentStamina: number;
    lastShoveTime: number;      // Game time of the last shove
    isRestricted: boolean;      // Is melee input currently locked?
    isCurrentlyMeleeing: boolean; // Tracks the melee input state
}
let playerShoveStates: {[key: number]: ShoveState} = {};
let zombieStunTimers: {[zombieId: number]: number} = {}; // Key: zombieId, Value: game time when stun ends
let zombiePreviousHealth: {[zombieId: number]: number} = {}; // <-- NEW: Track health for damage detection
// NEW: Tracks which players performed a damage-triggering swing this tick.
let shovesRequestedThisTick: {[playerId: number]: {
    playerPos: mod.Vector, 
    playerFacing: mod.Vector
}} = {};
// ===========================
let playerMeleeWeapon: {[playerId: number]: mod.Gadgets} = {};
let playerMeleePapTier: {[playerId: number]: number} = {};
let drillerUIActive: {[playerId: number]: boolean} = {};
let playerPrimaryWeapon: {[playerId: number]: mod.Weapons} = {};
let playerSecondaryWeapon: {[playerId: number]: mod.Weapons} = {};
let playerPrimaryPapTier: {[playerId: number]: number} = {};
let playerSecondaryPapTier: {[playerId: number]: number} = {};
let lastMaxAmmoEventRound
let maxAmmoEventActive = false;
let maxAmmoZombiesRemaining = 0;
let maxAmmoZombieIds: Set<number> = new Set();
let maxAmmoEventLastDeathPosition: mod.Vector | undefined = undefined;
type PlayerWeaponData = {
    weapon: mod.Weapons;
    package: mod.WeaponPackage;
    papTier: number;
};
let playerWeapons: {[playerId: number]: {[slot: number]: PlayerWeaponData}} = {};
// Game Configuration
const MIN_PLAYERS_TO_START = 1;
const ZOMBIES_PER_WAVE_BASE = 6;
const ZOMBIE_HEALTH_BASE = 150;
const ZOMBIE_HEALTH_MULTIPLIER = 1.1; // Health increases by 10% per wave
const TIME_BETWEEN_SPAWNS = 2; // seconds, 4, or 2
const WAVE_DELAY = 15; // seconds between waves
let zombieLastTargetUpdate: {[key: number]: number} = {};
let ZOMBIE_TARGET_UPDATE_INTERVAL = 0.6; // Update target every .6 seconds
let playerLastWeapon: {[key: number]: mod.InventorySlots} = {}; // Track last held weapon per player
const SPAWNER_MARKER_ID_OFFSET = 12000;
let playerSlotWeapons: {[playerId: number]: {[slot: number]: mod.Weapons}} = {};
let activeSpawnerIds: Set<number> = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 
21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 
 51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
 61, 62, 63, 64]); // 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64
let currentWave = 0;
let zombiesRemaining = 0;
let zombiesAlive = 0;
let roundActive = false;
let playerCount = 0;
let gameStarted = false;
let gameOver = false;

/**
 * Normalizes a 3D vector (X, Y, Z) to create a unit vector (length 1).
 * This is crucial for projecting movement direction without being affected by distance.
 * @param V The mod.Vector to normalize.
 * @returns A new mod.Vector representing the normalized direction.
 */
function CustomVectorNormalize(V: mod.Vector): mod.Vector {
    const x = mod.XComponentOf(V);
    const y = mod.YComponentOf(V);
    const z = mod.ZComponentOf(V);
    
    // Calculate the magnitude (length) of the vector
    const magnitude = Math.sqrt((x * x) + (y * y) + (z * z));
    
    // Check if the magnitude is close to zero to prevent division by zero
    if (magnitude < 0.0001) {
        // Return the zero vector if the input vector has no magnitude
        return mod.CreateVector(0, 0, 0); 
    }
    
    // Return a new vector where each component is divided by the magnitude
    return mod.CreateVector(x / magnitude, y / magnitude, z / magnitude);
}

/**
 * Calculates the 2D distance (X and Z) between two vectors, ignoring height.
 */
function CustomVectorDistance2D(A: mod.Vector, B: mod.Vector): number {
    const deltaX = mod.XComponentOf(A) - mod.XComponentOf(B);
    const deltaZ = mod.ZComponentOf(A) - mod.ZComponentOf(B);
    // Standard distance formula: sqrt(x*x + z*z)
    return Math.sqrt((deltaX * deltaX) + (deltaZ * deltaZ));
}

/**
 * Custom function to subtract Vector B from Vector A: A - B.
 * Uses mod.XComponentOf() to access vector components.
 */
function CustomVectorSubtract(A: mod.Vector, B: mod.Vector): mod.Vector {
    return mod.CreateVector(
        mod.XComponentOf(A) - mod.XComponentOf(B), // Subtract X components
        mod.YComponentOf(A) - mod.YComponentOf(B), // Subtract Y components
        mod.ZComponentOf(A) - mod.ZComponentOf(B)  // Subtract Z components
    );
}

/**
 * Custom function to calculate the square of a vector's length (Distance Squared).
 * Uses mod.XComponentOf() to access vector components.
 */
function CustomVectorLengthSq(V: mod.Vector): number {
    const vx = mod.XComponentOf(V);
    const vy = mod.YComponentOf(V);
    const vz = mod.ZComponentOf(V);
    
    // Calculation: x² + y² + z²
    return (vx * vx) + (vy * vy) + (vz * vz);
}

/**
 * Checks the vertical distance against the ZOMBIE_LEAP_TIERS.
 * Returns the entire matched tier object (or null) if a match is found.
 */
function getLeapTierForHeight(yDifference: number): ZombieLeapTier | null {
    for (const tier of ZOMBIE_LEAP_TIERS) {
        if (yDifference >= tier.minHeight && yDifference <= tier.maxHeight) {
            
            // Log which tier was chosen
            console.log(
                `[LEAP TIER MATCH] Height: ${yDifference.toFixed(1)}m. Matched Tier: ${tier.minHeight}m to ${tier.maxHeight}m. (Limit: ${tier.horizontalLimit}m, Duration: ${tier.duration}s, Windup: ${tier.windupDelay}s, Boost D: ${tier.boostDuration}s)`
            );
            
            return tier; // Found a matching tier
        }
    }
    
    // Player's height didn't fall into any valid leap bracket
    return null;
}

function findNearestHumanPlayer(targetPos: mod.Vector): mod.Player | null {
    let nearestPlayer: mod.Player | null = null;
    let shortestDistSq = Infinity;
    
    for (const idStr in ZombiePlayer.allPlayers) {
        const zpInstance = ZombiePlayer.allPlayers[parseInt(idStr)];
        const player = zpInstance.player;
        
        // Skip invalid, dead, or AI players
        if (!mod.IsPlayerValid(player) || !mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive) || mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) {
            continue;
        }

        const playerPos = mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
        const distSq = CustomVectorLengthSq(CustomVectorSubtract(playerPos, targetPos));
        
        if (distSq < shortestDistSq) {
            shortestDistSq = distSq;
            nearestPlayer = player;
        }
    }
    return nearestPlayer;
}

/**
 * Executes the Hunter's propelled leap, checking for player collision every tick.
 * This is an asynchronous function that handles the full duration of the leap.
 */
async function performHunterLeap(hunter: mod.Player, target: mod.Player, targetId: number) {
    const hunterId = mod.GetObjId(hunter);
    
    // Check if another pounce has already started before or during the first tick
    if (isHunterPounceActive) {
        // Stop if a global lock exists before starting the leap
        hunterPounceStates[hunterId].state = 'idle';
        mod.AISetMoveSpeed(hunter, mod.MoveSpeed.Sprint);
        return;
    }
    
    const hunterPos = mod.GetSoldierState(hunter, mod.SoldierStateVector.GetPosition);
    const targetPos = mod.GetSoldierState(target, mod.SoldierStateVector.GetPosition);
    
    // 1. Calculate the final leap destination (Distance-based projection)
    
    // Use X, Z position difference for direction, ignore current Y height difference for direction calculation
    const directionXZ = CustomVectorSubtract(targetPos, hunterPos);
    const distanceXZ = CustomVectorDistance2D(hunterPos, targetPos);
    
    // Normalize the XZ direction vector to get unit vector
    const directionUnit = CustomVectorNormalize(directionXZ);
    
    // The final destination will be the hunter's current Y height + the target's Y height, 
    // ensuring the jump is vertical if the target is above or flat if they are below/level.
    // The jump distance is based on the max 8m check range.
    // FIX: Always aim for the max leap distance or more aggressively, 
    // ensuring the jump goes beyond the player's current position.
    const LEAP_DISTANCE = distanceXZ + 2.0; // Add 2m to the distance, or cap at MAX
    const finalLeapDistance = Math.min(LEAP_DISTANCE, HUNTER_POUNCE_MAX_LEAP_DISTANCE);
    
    // Create the final position (propel XZ, set Y-axis to target's Y for vertical component)
    let finalPos = mod.CreateVector(
        mod.XComponentOf(hunterPos) + mod.XComponentOf(directionUnit) * finalLeapDistance,
        mod.YComponentOf(targetPos), // Set Y-axis directly to the target's Y
        mod.ZComponentOf(hunterPos) + mod.ZComponentOf(directionUnit) * finalLeapDistance
    );
    
    // 2. Start the Propelled Movement
    const LEAP_TIME = HUNTER_POUNCE_LEAP_DURATION; // Now 0.4s
    const COLLISION_CHECK_TICK = 0.05; 
    let elapsedTime = 0;

    // Force hunter into a crouch stance for the dive animation
    mod.AISetStance(hunter, mod.Stance.Crouch); 
    
    // Propel the Hunter towards the final destination over LEAP_TIME
    mod.SetObjectTransformOverTime(
        hunter, 
        mod.CreateTransform(finalPos, mod.GetObjectRotation(hunter)), // Use current rotation
        LEAP_TIME, 
        false, 
        false
    );

    // 3. Collision Check Loop
    while (elapsedTime < LEAP_TIME) {
        
        // Get fresh positions
        const currentHunterPos = mod.GetSoldierState(hunter, mod.SoldierStateVector.GetPosition);
        const currentTargetPos = mod.GetSoldierState(target, mod.SoldierStateVector.GetPosition);
        
        // Check collision distance
        const distanceToTarget = mod.DistanceBetween(currentHunterPos, currentTargetPos);
        
        if (distanceToTarget <= HUNTER_POUNCE_PIN_RANGE) {
            // Collision detected! Stop movement and break
            mod.StopActiveMovementForObject(hunter);
            
            // Check if another pounce was locked right before this tick
            if (!isHunterPounceActive) {
                // Pin the player! The state machine will handle the transition to 'pinned'
                return; // Exit function, state machine picks up the collision
            } else {
                // Race condition loss: Another hunter/entity took the lock
                console.log("Hunter collision, but lost the global pounce lock.");
                break;
            }
        }
        
        // Check if the target is still valid (in case they died during the leap)
        if (!mod.IsPlayerValid(target)) {
            console.log("Hunter target invalid during leap. Aborting.");
            mod.StopActiveMovementForObject(hunter);
            break;
        }

        await mod.Wait(COLLISION_CHECK_TICK);
        elapsedTime += COLLISION_CHECK_TICK;
    }
    
    // 4. Leap Finished/Missed Cleanup
    console.log(`Hunter ${hunterId} leap finished/missed cleanup.`);
    
    // If the state is still 'leaping' (i.e., we finished the loop without pinning)
    if (hunterPounceStates[hunterId] && hunterPounceStates[hunterId].state === 'leaping') {
        // Cleanup state for a miss
        delete hunterPounceStates[hunterId]; 
        mod.AISetMoveSpeed(hunter, mod.MoveSpeed.InvestigateRun); // Go back to normal
        mod.AISetStance(hunter, mod.Stance.Stand);
        mod.SetPlayerMovementSpeedMultiplier(hunter, 1.5);
    }
}

/**
 * Searches for the nearest eligible Smoker to credit the pull by checking the dedicated Smoker ID set.
 */
function findNearestSmoker(victim: mod.Player, maxDistance: number): mod.Player | null {
    let nearestSmoker: mod.Player | null = null;
    let minDistanceSq = maxDistance * maxDistance; 
    const victimPos = mod.GetSoldierState(victim, mod.SoldierStateVector.GetPosition);
    let currentTime = mod.GetMatchTimeElapsed();
    const victimId = mod.GetObjId(victim);
    
    // NEW FIX: If the victim is already disabled, they cannot be pulled.
    if (disabledPlayerIds.has(victimId)) {
        return null; 
    } 
    
    const isGracePeriodActive = mod.GetMatchTimeElapsed() < smokerPullGracePeriodEndTime;

    // --- CRITICAL FIX: Iterate ONLY over the dedicated Smoker ID set ---
    // This prevents generic zombie IDs from ever entering the check.
    for (const id of smokerZombieIds) { 
        
        const zombie = Zombie.allZombies[id]; // Retrieve the zombie object
        
        // This check ensures the ID in the set is a tracked zombie and marked as a Smoker
        if (!zombie || !zombie.isSmokerZombie) {
            continue;
        }

        const smokerPlayer = zombie.player;

        if (mod.IsPlayerValid(smokerPlayer)) {
            
            // --- THIS IS THE FIX ---
            // 1. READINESS CHECK: Check if this Smoker is on the 10-second cooldown
            if (id === smokerIdAwaitingAmmo) {
                // This Smoker is in the penalty box. Check if the timer is still active.
                if (currentTime < smokerAmmoCooldownEndTime) {
                    continue; // Cooldown is active, Smoker is not ready.
                }
                // If timer is expired, they are ready (loop below will clear the ID)
            }
            
            // 2. GRACE PERIOD CHECK 
            if (isGracePeriodActive && id === smokerPullerId) { // Check the ID directly
                continue; 
            }
            
            const smokerPos = mod.GetSoldierState(smokerPlayer, mod.SoldierStateVector.GetPosition);
            
            // Calculate distance using custom functions
            const pullDirection = CustomVectorSubtract(victimPos, smokerPos);
            const distanceSq = CustomVectorLengthSq(pullDirection);

            // 3. Check distance
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                nearestSmoker = smokerPlayer;
            }
        }
    }
    return nearestSmoker;
}

function findNearestPlayer(zombiePosition: mod.Vector): mod.Player | undefined {
    let nearestPlayer: mod.Player | undefined = undefined;
    let nearestDistance = 999999;
    
    for (let id in ZombiePlayer.allPlayers) {
        let zPlayer = ZombiePlayer.allPlayers[id];
        
        // Only target alive players
        if (!zPlayer.isAlive || !mod.IsPlayerValid(zPlayer.player)) {
            continue;
        }
        
        let playerPos = mod.GetSoldierState(zPlayer.player, mod.SoldierStateVector.GetPosition);
        let distance = mod.DistanceBetween(zombiePosition, playerPos);
        
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestPlayer = zPlayer.player;
        }
    }
    
    return nearestPlayer;
}

// Player Management
class ZombiePlayer {
    player: mod.Player;
    playerId: number;
    kills: number = 0;
    deaths: number = 0;
    isAlive: boolean = false;
    isManDown: boolean = false;
    currentHealth: number;
    previousHealth: number;
    // UI Widgets
    pointsWidget: mod.UIWidget | undefined;
    waveWidget: mod.UIWidget | undefined;
    zombiesWidget: mod.UIWidget | undefined;
    containerWidget: mod.UIWidget | undefined;
    // === ADD THESE LINES ===
    engineerContainerId: mod.UIWidget | undefined;
    engineerBarId: mod.UIWidget | undefined;
    engineerTextId: mod.UIWidget | undefined;
    static allPlayers: {[key: number]: ZombiePlayer} = {};
    constructor(player: mod.Player) {
        this.player = player;
        this.playerId = mod.GetObjId(player);
        this.currentHealth = mod.GetSoldierState(player, mod.SoldierStateNumber.CurrentHealth);
        this.previousHealth = this.currentHealth; // Initialize
    }
    static get(player: mod.Player): ZombiePlayer | undefined {
        let id = mod.GetObjId(player);
        if (id > -1) {
            if (!this.allPlayers[id]) {
                this.allPlayers[id] = new ZombiePlayer(player);
            }
            return this.allPlayers[id];
        }
        return undefined;
    }
    static remove(playerId: number) {
        let zPlayer = this.allPlayers[playerId];
        if (zPlayer) {
            delete this.allPlayers[playerId];
        }
    }
}
// Zombie tracking
class Zombie {
    player: mod.Player;
    playerId: number;
    health: number;
    maxHealth: number;
    damageTracker: {[key: number]: number} = {};
    isMaxAmmoZombie: boolean = false;
    // --- New Smoker Property ---
    isSmokerZombie: boolean = false; // <--- ADD THIS
    isHunterZombie: boolean = false; // <<< ADD THIS
    // ---------------------------
    static allZombies: {[key: number]: Zombie} = {};
    constructor(player: mod.Player, health: number, isMaxAmmoZombie: boolean = false, isSmokerZombie: boolean = false, isHunterZombie: boolean = false) { // <--- UPDATE
        this.player = player;
        this.playerId = mod.GetObjId(player);
        this.maxHealth = health;
        this.health = health;
        this.isMaxAmmoZombie = isMaxAmmoZombie;
        this.isSmokerZombie = isSmokerZombie; // <--- ASSIGN THIS
        this.isHunterZombie = isHunterZombie;
        Zombie.allZombies[this.playerId] = this;
    }
    static get(player: mod.Player): Zombie | undefined {
        return this.allZombies[mod.GetObjId(player)];
    }
    static remove(playerId: number) {
        delete this.allZombies[playerId];
    }
    takeDamage(damage: number, attacker: mod.Player, isHeadshot: boolean) {
        let attackerId = mod.GetObjId(attacker);
        
        if (!this.damageTracker[attackerId]) {
            this.damageTracker[attackerId] = 0;
        }
        this.damageTracker[attackerId] += damage;
        
        this.health -= damage;
        
        let zPlayer = ZombiePlayer.get(attacker);
        if (zPlayer) {
            if (isHeadshot) {
            } else {
            }
        }
    }
}
// Helper function to check if all players are dead/down
function areAllPlayersDead(): boolean {
    let allPlayers = mod.AllPlayers();
    let playerCount = mod.CountOf(allPlayers);
    
    let aliveHumanCount = 0 //= getAliveHumanPlayerCount();
    
    for (let i = 0; i < playerCount; i++) {
        let player = mod.ValueInArray(allPlayers, i) as mod.Player;
        
        // Skip if not a valid player
        if (!mod.IsPlayerValid(player)) continue;
        
        // Skip AI players (zombies)
        if (mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) continue; //(mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier) && mod.GetTeam(player) == mod.GetTeam(1)) continue;
        
        // This is a human player - check if they're alive
        let isAlive = mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);
        let isManDown = mod.GetSoldierState(player, mod.SoldierStateBool.IsManDown);
        
        // Player is alive and NOT in mandown = they're alive
        if (isAlive && !isManDown) {
            aliveHumanCount++;
        }
    }
    
    console.log("Alive human players: ", aliveHumanCount);
    return aliveHumanCount === 0;
}
function findClosestSpawnerToPlayer(player: mod.Player): number | undefined {
    if (!mod.IsPlayerValid(player)) return undefined;
    
    let playerPos = mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
    let activeSpawners = Array.from(activeSpawnerIds);
    
    if (activeSpawners.length === 0) {
        return undefined;
    }
    
    // Calculate distances and weights for all spawners
    let spawnerWeights: {id: number, weight: number}[] = [];
    
    for (let spawnerId of activeSpawners) {
        // Get marker spatial object position
        let markerObject = mod.GetSpatialObject(SPAWNER_MARKER_ID_OFFSET + spawnerId);
        let markerPos = mod.GetObjectPosition(markerObject);
        
        // Calculate distance using only X and Z (ignore Y/height)
        let playerX = mod.XComponentOf(playerPos);
        let playerZ = mod.ZComponentOf(playerPos);
        let markerX = mod.XComponentOf(markerPos);
        let markerZ = mod.ZComponentOf(markerPos);
        
        let deltaX = playerX - markerX;
        let deltaZ = playerZ - markerZ;
        let distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
        
        // Inverse distance weighting - closer = higher weight
        // Add 1 to avoid division by zero if player is exactly on spawner
        let weight = 10000 / ((distance + 1) * (distance + 1));
        
        spawnerWeights.push({id: spawnerId, weight: weight});
    }
    
    // Calculate total weight
    let totalWeight = 0;
    for (let sw of spawnerWeights) {
        totalWeight += sw.weight;
    }
    
    // Pick random spawner based on weights
    let randomValue = Math.random() * totalWeight;
    let cumulativeWeight = 0;
    
    for (let sw of spawnerWeights) {
        cumulativeWeight += sw.weight;
        if (randomValue <= cumulativeWeight) {
            return sw.id;
        }
    }
    
    // Fallback (shouldn't reach here)
    return spawnerWeights[0].id;
}
function getRandomAlivePlayer(): mod.Player | undefined {
    let alivePlayers: mod.Player[] = [];
    
    for (let id in ZombiePlayer.allPlayers) {
        let zPlayer = ZombiePlayer.allPlayers[id];
        
        if (zPlayer.isAlive && mod.IsPlayerValid(zPlayer.player)) {
            alivePlayers.push(zPlayer.player);
        }
    }
    
    if (alivePlayers.length === 0) {
        return undefined;
    }
    
    // Pick random player from alive players
    let randomIndex = Math.floor(Math.random() * alivePlayers.length);
    return alivePlayers[randomIndex];
}
function getAlivePlayerCount(): number {
    let count = 0;
    
    for (let id in ZombiePlayer.allPlayers) {
        let zPlayer = ZombiePlayer.allPlayers[id];
        if (zPlayer.isAlive && mod.IsPlayerValid(zPlayer.player)) {
            count++;
        }
    }
    
    return Math.max(1, count); // Minimum 1 to avoid zero zombies
}
function calculateWaWZombieCount(round: number, playerCount: number): number {
    const ROUND_1_COUNTS = [55, 8, 11, 14, 17];  // [1p, 2p, 3p, 4p, 5p], 6, 9, 13, 18, 24 55
    const ROUND_2_COUNTS = [9, 11, 14, 18, 21];
    const ROUND_3_COUNTS = [13, 15, 20, 25, 31];
    const ROUND_4_COUNTS = [18, 20, 25, 33, 40];
    const ROUND_5_COUNTS = [24, 25, 32, 42, 48];
    
    // Handle rounds 1-5 with hardcoded values
    let playerIndex = Math.min(playerCount, 5) - 1; // Clamp to 1-5 players
    
    if (round === 1) return ROUND_1_COUNTS[playerIndex];
    if (round === 2) return ROUND_2_COUNTS[playerIndex];
    if (round === 3) return ROUND_3_COUNTS[playerIndex];
    if (round === 4) return ROUND_4_COUNTS[playerIndex];
    if (round === 5) return ROUND_5_COUNTS[playerIndex];
    
    let max = ZOMBIE_MAX_AI_BASE;
    let multiplier = round / 5;
    
    if (multiplier < 1) {
        multiplier = 1;
    }
    
    if (round >= 10) {
        multiplier *= (round * 0.15);
    }
    
    // === 1 PLAYER ===
    if (playerCount == 1) {
        // For rounds below 29
        if (round < 29) {
            max += Math.floor(0.5 * ZOMBIE_AI_PER_PLAYER * multiplier);
        }
        // Calculate caps dynamically for rounds 29+
        if (round >= 29) {
            // Start from 97 zombies for Round 29
            let baseZombies = 97;
            let addedZombies = 0;
            
            // Loop through rounds and add zombies
            for (let i = 0; i < (round - 29); i++) {
                if ((29 + i) % 2 == 1) {  // Odd round: add 2 zombies
                    addedZombies += 2;
                } else {  // Even round: add 3 zombies
                    addedZombies += 3;
                }
            }
            
            max = baseZombies + addedZombies;
        }
    }
    
    // === 2 PLAYERS ===
    else if (playerCount == 2) {
        // For rounds below 29
        if (round < 29) {
            max += Math.floor((playerCount - 1) * ZOMBIE_AI_PER_PLAYER * multiplier);
        }
        // Calculate caps dynamically for rounds 29+
        if (round >= 29) {
            // Start from 180 zombies for Round 29
            let baseZombies = 180;
            let addedZombies = 0;
            
            // Loop through rounds
            for (let i = 0; i < (round - 29); i++) {
                if ((29 + i) % 2 == 1) {  // Odd rounds: add 5 zombies
                    addedZombies += 5;
                } else {  // Even rounds: add 6 zombies
                    addedZombies += 6;
                }
            }
            
            max = baseZombies + addedZombies;
        }
    }
    
    // === 3 PLAYERS ===
    else if (playerCount == 3) {
        // For rounds below 20
        if (round < 20) {
            max += Math.floor((playerCount - 1) * ZOMBIE_AI_PER_PLAYER * multiplier);
        }
        // Calculate caps dynamically for rounds 20+
        if (round >= 20) {
            // Start from 168 zombies for Round 20
            let baseZombies = 168;
            let addedZombies = 0;
            
            // Loop through rounds from 20 onwards
            for (let i = 0; i < (round - 20); i++) {
                if ((20 + i) % 5 == 0) {  // Every 5th round: add 8 zombies
                    addedZombies += 8;
                } else {  // Other rounds: add 7 zombies
                    addedZombies += 7;
                }
            }
            
            max = baseZombies + addedZombies;
        }
    }
    
    // === 4 PLAYERS ===
    else if (playerCount >= 4) {
        // For rounds below 20
        if (round < 20) {
            max += Math.floor((playerCount - 1) * ZOMBIE_AI_PER_PLAYER * multiplier);
        }
        // Calculate caps dynamically for rounds 20+
        if (round >= 20) {
            // Starting from 204 zombies at Round 20
            let baseZombies = 204;
            
            // Add 9 zombies per round after 20
            max = baseZombies + ((round - 20) * 9);
        }
    }
    
    return max;
}
// Main game loop
export async function OnGameModeStarted() {
    console.log("Zombies Mode Started - Version ", VERSION[0], ".", VERSION[1], ".", VERSION[2]);
    
    mod.SetSpawnMode(mod.SpawnModes.AutoSpawn);
    mod.SetFriendlyFire(false);
    
    // Initialize max ammo event
    lastMaxAmmoEventRound = 0;
    
    while (playerCount < MIN_PLAYERS_TO_START) {
        await mod.Wait(1);
    }
    
    gameStarted = true;
    await mod.Wait(5);
    await showLoreIntro();

    updateTargetIntervalLoop()
    
    startWave();
}
async function startWave() {
    if (gameOver) return;
    
    currentWave++;
    
    // Check if this should be a max ammo event round
    if (currentWave % MAX_AMMO_EVENT_ROUNDS === 0) {
        // This is a max ammo event round (5, 10, 15, 20...)
        console.log("ROUND ", currentWave, " IS A MAX AMMO EVENT ROUND");
        lastMaxAmmoEventRound = currentWave;
        roundActive = true; // SET THIS FIRST
        return; // Don't start normal wave
    }
    
    // Normal wave logic
    roundActive = true;
    
    let alivePlayerCount = getAlivePlayerCount();
    zombiesRemaining = calculateWaWZombieCount(currentWave, alivePlayerCount);
    zombiesAlive = 0;
    
    console.log("Starting wave ", currentWave, " with ", zombiesRemaining, " zombies (", alivePlayerCount, " players, WaW formula)");
    
    
    updateAllPlayerUI();
    spawnWave();
}


async function spawnWave() {
    let zombieHealth = Math.floor(ZOMBIE_HEALTH_BASE * Math.pow(ZOMBIE_HEALTH_MULTIPLIER, currentWave - 1));
    
    // Convert Set to array for fallback
    let activeSpawners = Array.from(activeSpawnerIds);

    // This loop now runs as long as the round is active
    while (roundActive && !gameOver) { 

        // Check if we are BELOW the cap (9) AND still have zombies left in the wave's quota
        if (zombiesAlive < 55 && zombiesRemaining > 0) { //55
            
            // We are below the cap, spawn one
            let spawnerId: number;
            
            // Try to spawn from spawner closest to a random alive player
            let randomPlayer = getRandomAlivePlayer();
            
            if (randomPlayer) {
                let closestSpawner = findClosestSpawnerToPlayer(randomPlayer);
                
                if (closestSpawner !== undefined) {
                    spawnerId = 100 + closestSpawner;
                } else {
                    let randomIndex = Math.floor(Math.random() * activeSpawners.length);
                    spawnerId = 100 + activeSpawners[randomIndex];
                }
            } else {
                let randomIndex = Math.floor(Math.random() * activeSpawners.length);
                spawnerId = 100 + activeSpawners[randomIndex];
            }
            
            let spawner = mod.GetSpawner(spawnerId);
            mod.SpawnAIFromAISpawner(spawner, mod.SoldierClass.Assault, mod.Message("Infected"), mod.GetTeam(1));
            
            // Wait the normal spawn time before checking again
            await mod.Wait(TIME_BETWEEN_SPAWNS);
            
        } else {
            // We are AT the cap (9) or the wave's quota is empty
            // Wait a short time before checking again
            await mod.Wait(1.0); //0.5
        }
    }
}
async function endWave() {
    if (gameOver) return; // Don't continue waves during game over
    
    roundActive = false;
    
    console.log("Wave ", currentWave, " complete!");
    mod.DisplayNotificationMessage(mod.Message(mod.stringkeys.wave_complete, currentWave));
    
    // Kill all remaining zombies during the delay period
    let delayRemaining = WAVE_DELAY;
    while (delayRemaining > 1) {
        // Despawn any zombies that spawned or are still alive
        for (let zombieId in Zombie.allZombies) {
            let zombie = Zombie.allZombies[zombieId];
            if (zombie && zombie.player && mod.IsPlayerValid(zombie.player)) {
                mod.Kill(zombie.player);
            }
            Zombie.remove(parseInt(zombieId));
        }
        
        zombiesAlive = 0;
        
        await mod.Wait(1);
        delayRemaining--;
    }
    
    
    // Start next wave
    if (!gameOver) {
        startWave();
    }
}
function updateAllPlayerUI() {
    for (let id in ZombiePlayer.allPlayers) {
    }
}
// Event Handlers
export function OnPlayerJoinGame(player: mod.Player) {
    if (!mod.IsPlayerValid(player)) {
        console.log("Invalid player tried to join, ignoring");
        return;
    }
    if (mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) {
        return; // Ignore AI
    }
    
    // Force player to team 2 immediately
    mod.SetTeam(player, mod.GetTeam(2));
    
    ZombiePlayer.get(player);
    playerCount++;
    
    // Initialize weapon tracking
    let playerId = mod.GetObjId(player);
    playerLastWeapon[playerId] = mod.InventorySlots.PrimaryWeapon;
    
    console.log("Player joined. Total players: ", playerCount);
}
export function OnPlayerLeaveGame(playerId: number) {
    let wasHumanPlayer = ZombiePlayer.allPlayers[playerId] !== undefined;
    const zpInstance = ZombiePlayer.allPlayers[playerId];
    
    if (wasHumanPlayer) {
        ZombiePlayer.remove(playerId);
        playerCount--;
        console.log("Human player left. Total players: ", playerCount);
    } else {
        // This was a zombie AI leaving - just clean up tracking
        console.log("Zombie AI left game, cleaning up tracking for ID: ", playerId);
    }
    
    // Clean up weapon tracking
    delete playerLastWeapon[playerId];
    delete playerWeapons[playerId];
    delete playerPrimaryWeapon[playerId];
    delete playerSecondaryWeapon[playerId];
    delete playerMeleeWeapon[playerId];
    delete playerShoveStates[playerId]; // <-- ADD THIS
    if (playerReloadTracking[playerId]) {
            delete playerReloadTracking[playerId];
        }
        // Cleanup Engineer State
        if (engineerStates[playerId]) {
             delete engineerStates[playerId];
        }

        // Cleanup Engineer UI
        if (zpInstance) {
            // Call the new global function
            destroyEngineerUI(zpInstance);
        }

        // Cleanup Support State (Ammo Bonus)
    if (supportStates[playerId]) { // <-- NEW CLEANUP
         delete supportStates[playerId];
    }
    
    console.log("Player left. Total players: ", playerCount);
}
function getZombieHealth(round: number): number {
    if (round <= 5) {
        return 200;
    } else if (round <= 10) {
        return 200 + ((round - 5) * 100);
    } else if (round <= 15) {
        return 700 + ((round - 10) * 100);
    } else if (round <= 30) {
        return 1200 - ((round - 15) * 20);
    } else {
        return 900;
    }
}

export async function OnPlayerDeployed(player: mod.Player) {
    let isAI = mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier);
    
    if (isAI) {
        // Get zombie spawn position
        let zombiePos = mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
        
        // Spawn green/toxic spawn effect
        try {
            let spawnVFX: mod.VFX = mod.SpawnObject(
                mod.RuntimeSpawn_Common.FX_BASE_Sparks_Pulse_L,
                zombiePos,
                mod.CreateVector(0, 0, 0)
            );
            
            // Green toxic color for zombies
            mod.SetVFXColor(spawnVFX, mod.CreateVector(0.2, 1, 0.2));
            
            // Scale it to be noticeable but not overwhelming
            mod.SetVFXScale(spawnVFX, 1.5);
            
            // Enable the VFX
            mod.EnableVFX(spawnVFX, true);
            
            // Auto-cleanup after 2 seconds
            setTimeout(() => {
                try {
                    mod.EnableVFX(spawnVFX, false);
                    mod.UnspawnObject(spawnVFX);
                } catch (e) {
                    console.log("VFX cleanup error: ", e);
                }
            }, 2000);
            
            console.log("Spawned zombie VFX at position");
            
        } catch (e) {
            console.log("Error spawning zombie VFX: ", e);
        }
        // Check if this is a max ammo event zombie
        let isMaxAmmoZombie = maxAmmoEventActive && maxAmmoZombiesRemaining > 0;

        // --- NEW SMOKER CHECK & INITIALIZATION ---
        const playerId = mod.GetObjId(player);
        let isSmokerZombie = false;
        let isHunterZombie = false; // <<< ADD THIS

        // Check if we've hit the global special limit
        if (specialsAlive < MAX_ALIVE_SPECIALS) {              
        // Only attempt to spawn a Smoker if a normal round is active, 
        // it's not a Max Ammo zombie, and we are below the Smoker cap.
        if (roundActive && !isMaxAmmoZombie && !isHunterZombie && !isSmokerOnCooldown && smokersAlive < MAX_ALIVE_SMOKERS) {
            if (Math.random() < SMOKER_SPAWN_CHANCE) {
                isSmokerZombie = true;
                smokersAlive++; // Increment counter
                specialsAlive++; // <--- INCREMENT TOTAL COUNT
                smokerZombieIds.add(playerId); 
                console.log("Spawned a new SMOKER ZOMBIE! Total smokers alive: ", smokersAlive);
            }
        }
        }
        // ----------------------------------------

        // Check global limit again (it might have been hit by the Smoker above)
        if (specialsAlive < MAX_ALIVE_SPECIALS) {

        // --- NEW HUNTER CHECK & INITIALIZATION ---
        // Only spawn if not a Smoker and not Max Ammo
        if (roundActive && !isMaxAmmoZombie && !isSmokerZombie && huntersAlive < MAX_ALIVE_HUNTERS) {
            if (Math.random() < HUNTER_SPAWN_CHANCE) {
                isHunterZombie = true;
                huntersAlive++;
                specialsAlive++; // <--- INCREMENT TOTAL COUNT
                hunterZombieIds.add(playerId);
                console.log("Spawned a new HUNTER ZOMBIE! Total hunters alive: ", huntersAlive);
            }
        }
        }
        // ----------------------------------------
        
        let zombieHealth = isMaxAmmoZombie  ? MAX_AMMO_ZOMBIE_HEALTH : getZombieHealth(currentWave); // Regular zombies use curve

        let zombie = new Zombie(player, zombieHealth, isMaxAmmoZombie, isSmokerZombie, isHunterZombie); // <--- UPDATE CONSTRUCTOR CALL
        
        if (isMaxAmmoZombie) {
            maxAmmoZombieIds.add(mod.GetObjId(player));
            console.log("Spawned MAX AMMO zombie with ", zombieHealth, " HP");
        }
        
        mod.SetPlayerMaxHealth(player, zombieHealth);
        mod.Heal(player, zombieHealth);
        
        let team1 = mod.GetTeam(1);
        let currentTeam = mod.GetTeam(player);
        if (mod.GetObjId(currentTeam) !== mod.GetObjId(team1)) {
            mod.SetTeam(player, team1);
        }
        
        // Remove weapons
        mod.RemoveEquipment(player, mod.InventorySlots.PrimaryWeapon);
        mod.RemoveEquipment(player, mod.InventorySlots.SecondaryWeapon);
        mod.RemoveEquipment(player, mod.InventorySlots.GadgetOne);
        mod.RemoveEquipment(player, mod.InventorySlots.GadgetTwo);
        mod.RemoveEquipment(player, mod.InventorySlots.Throwable);
        mod.RemoveEquipment(player, mod.InventorySlots.MeleeWeapon);
        mod.AIEnableShooting(player, false);
        mod.AIEnableTargeting(player, true);
        mod.SetAIToHumanDamageModifier(0.20);
        //mod.AddEquipment(player, mod.Gadgets.Melee_Sledgehammer);
        
        // --- SMOKER WEAPON AND AI SETUP ---
        if (isSmokerZombie) {
            // Give the Smoker its signature weapon (SV-98)
            let ZombieName = mod.Message("Smoker")
            let SmokerWeapon: mod.WeaponPackage = mod.CreateNewWeaponPackage();
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Bottom_Full_Angled, SmokerWeapon);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Muzzle_Single_port_Brake, SmokerWeapon);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Barrel_24_Full, SmokerWeapon);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Scope_SSDS_600x, SmokerWeapon);
            //mod.AddEquipment(player, mod.Weapons.Sniper_M2010_ESR, SmokerWeapon);
            mod.AddEquipment(player, mod.Weapons.Sniper_SV_98);
            mod.AIEnableShooting(player, true); // Allow the Smoker to shoot
            mod.AIEnableTargeting(player, true);
            mod.AISetMoveSpeed(player, mod.MoveSpeed.InvestigateWalk); // Smokers are slow
            mod.AISetStance(player, mod.Stance.Stand);
            mod.SetPlayerMovementSpeedMultiplier(player, 1.25); //1.25
            mod.SetPlayerMaxHealth(player, 350);
            mod.SetInventoryAmmo(player, mod.InventorySlots.PrimaryWeapon, 0);
            mod.SetInventoryMagazineAmmo(player, mod.InventorySlots.PrimaryWeapon, 0);

        // --- NEW HUNTER SETUP ---
        } else if (isHunterZombie) {
            let ZombieName = mod.Message("Hunter");
            
            // Hunters are fast, crouched, and have no weapons
            mod.AddEquipment(player, mod.Gadgets.Melee_Hunting_Knife);
            mod.AIEnableShooting(player, false);
            mod.AIEnableTargeting(player, true);
            mod.AISetMoveSpeed(player, mod.MoveSpeed.InvestigateRun); // Fast
            //mod.AISetStance(player, mod.Stance.Crouch); // Always crouched
            mod.SetPlayerMovementSpeedMultiplier(player, 1.5); // Faster than Smoker
            mod.SetPlayerMaxHealth(player, 250); // Hunter health

        } else {
            // Max ammo zombies are FAST and CROUCH-SPRINT
        if (isMaxAmmoZombie) {
            mod.AISetMoveSpeed(player, mod.MoveSpeed.Sprint);
            mod.AISetStance(player, mod.Stance.Crouch); // Crouch stance
        } else {
            // Normal zombie speed logic
            if (currentWave <= 5) {
                //mod.AISetMoveSpeed(player, mod.MoveSpeed.Walk);
                let ZombieName = mod.Message("Zombie")
                mod.AISetMoveSpeed(player, mod.MoveSpeed.Sprint);
                mod.AISetStance(player, mod.Stance.Stand);
                mod.SetPlayerMovementSpeedMultiplier(player, 2.25);
                mod.SetPlayerMaxHealth(player, 110); //110
            } else if (currentWave <= 10) {
                mod.AISetMoveSpeed(player, mod.MoveSpeed.Run);
            } else {
                mod.AISetMoveSpeed(player, mod.MoveSpeed.Sprint);
            }
        }
        }
        
        let nearestPlayer = findNearestPlayer(zombiePos);
        
        if (nearestPlayer) {
            let playerPos = mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetPosition);
            mod.AIMoveToBehavior(player, playerPos);
            mod.AISetTarget(player, nearestPlayer);
        }
        let zombieId = mod.GetObjId(player);
        zombieLastTargetUpdate[zombieId] = mod.GetMatchTimeElapsed();
        
    } else {
        // Human player
        let zPlayer = ZombiePlayer.get(player);
        if (zPlayer) {
            let team2 = mod.GetTeam(2);
            let currentTeam = mod.GetTeam(player);
            if (mod.GetObjId(currentTeam) !== mod.GetObjId(team2)) {
                mod.SetTeam(player, team2);
            }
            
            if (gameOver) {
                return;
            }
            
            zPlayer.isAlive = true;
            const playerId = mod.GetObjId(player); // Get ID for state maps
            const currentTime = mod.GetMatchTimeElapsed(); // Get time for init

            //  --- THE DEFINITIVE FIX --- 
            // We must wait until the engine has actually assigned a class.
            // We'll check every 0.1s until one of the classes returns true.
            let isClassLoaded = false;
            while (!isClassLoaded) {
                if (mod.IsSoldierClass(player, mod.SoldierClass.Engineer) || 
                    mod.IsSoldierClass(player, mod.SoldierClass.Support) || 
                    mod.IsSoldierClass(player, mod.SoldierClass.Assault) || 
                    mod.IsSoldierClass(player, mod.SoldierClass.Recon)) {
                    isClassLoaded = true;
                } else {
                    // Class is not ready, wait another tick
                    await mod.Wait(0.1); 
                }
            }
            //  ------------------------------- 
            
            // --- Now we can proceed, knowing the class checks are reliable ---
            
            //mod.RemoveEquipment(player, mod.InventorySlots.PrimaryWeapon);
            //mod.RemoveEquipment(player, mod.InventorySlots.SecondaryWeapon);
            //mod.RemoveEquipment(player, mod.InventorySlots.GadgetOne);
            //mod.RemoveEquipment(player, mod.InventorySlots.GadgetTwo);
            //mod.RemoveEquipment(player, mod.InventorySlots.Throwable);
            
            let myWeaponPackage: mod.WeaponPackage = mod.CreateNewWeaponPackage();  
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Ergonomic_Improved_Mag_Catch, myWeaponPackage);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Bottom_50_mW_Green, myWeaponPackage);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Muzzle_Single_port_Brake, myWeaponPackage);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Ammo_Tungsten_Core, myWeaponPackage);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Magazine_11rnd_Magazine, myWeaponPackage);
            mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Barrel_114mm_Pencil, myWeaponPackage);
            //mod.AddEquipment(player, (mod as any)?.Weapons.Sidearm_GGH_22, myWeaponPackage);
            //mod.AddEquipment(player, (mod as any)?.Weapons.LMG_DRS_IAR, mod.InventorySlots.SecondaryWeapon);

    // ===================================
    // --- 1. CLASS-SPECIFIC SETUP ---
    // ===================================

    if (mod.IsSoldierClass(player, mod.SoldierClass.Engineer)) { 
        // --- ENGINEER ---
        mod.SetPlayerMaxHealth(player, ENGINEER_MAX_HEALTH);
        mod.SetPlayerMovementSpeedMultiplier(player, 1.04);
        mod.RemoveEquipment(player, mod.InventorySlots.MeleeWeapon);
        mod.RemoveEquipment(player, mod.InventorySlots.SecondaryWeapon);
        await mod.Wait(2);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, true);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, true);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Prone, true);
        mod.AddEquipment(player, mod.Gadgets.Melee_Sledgehammer);
        mod.AddEquipment(player, (mod as any)?.Weapons.LMG_M_60, mod.InventorySlots.SecondaryWeapon);
        mod.SetInventoryMagazineAmmo(player, SECONDARY_WEAPON_SLOT, 0);
        
        // 2. Initialize Engineer State
        if (!engineerStates[playerId]) {
            // Get the secondary weapon's max magazine ammo to calculate replenishment amount
            // You may need to wait a tick or two if this returns 0 immediately after deployment
            await mod.Wait(2);
            const maxMagAmmo = mod.GetInventoryAmmo(player, SECONDARY_WEAPON_SLOT);
            
            engineerStates[playerId] = {
                playerId: playerId,
                overheatTimer: ENGINEER_MAX_OVERHEAT,
                isOverheated: false,
                lastFiredTime: 0, // <-- BUG FIX: Initialize to 0, not currentTime
                lastReplenishTime: currentTime,
                lastIncrementTime: currentTime,
                lockoutEndTime: 0,
                // Ensure maxMagAmmo is at least 1 for calculations
                maxMagAmmo: maxMagAmmo > 0 ? maxMagAmmo : 50 
            };
            console.log(`Engineer state initialized for Player ${playerId}. Max Health: 400.`);

            // 3. WIDGET CREATION
            // Call the new global function
            await mod.Wait(2);
            createEngineerUI(player);
        }

    } else if (mod.IsSoldierClass(player, mod.SoldierClass.Support)) {
        // --- SUPPORT ---
        mod.SetPlayerMaxHealth(player, SUPPORT_MAX_HEALTH);
        mod.SetPlayerMovementSpeedMultiplier(player, 1.3);
        mod.RemoveEquipment(player, mod.InventorySlots.MeleeWeapon);
        await mod.Wait(2);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, true);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, true);
        mod.AddEquipment(player, mod.Gadgets.Melee_Combat_Knife);
        
        // ============================================
        // B. SUPPORT SETUP (Ammo Bonus Logic)
        // ============================================

        if (!supportStates[playerId]) {
            await mod.Wait(2); 
            const baseMagAmmo = mod.GetInventoryAmmo(player, SECONDARY_WEAPON_SLOT);
            const bonusRounds = Math.floor(baseMagAmmo * 0.5);

            supportStates[playerId] = {
                playerId: playerId,
                extraRounds: bonusRounds,
                lastFiredBonusTime: currentTime,
                maxMagAmmo: baseMagAmmo > 0 ? baseMagAmmo : 50,
                ammoCountLastTick: baseMagAmmo, // <-- INITIALIZE HERE 
            };
            console.log(`Support state initialized for Player ${playerId}. Bonus Rounds: ${bonusRounds}.`);
        }

        } else {
                // --- DEFAULT (Assault, Recon, etc.) ---
                mod.SetPlayerMovementSpeedMultiplier(player, 1.3);
                mod.SetPlayerMaxHealth(player, 250);
                mod.RemoveEquipment(player, mod.InventorySlots.MeleeWeapon);
                await mod.Wait(2);
                mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, true);
                mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, true);
                mod.AddEquipment(player, mod.Gadgets.Melee_Combat_Knife);
            }

            // ===================================
            // --- 2. UNIVERSAL HUMAN SETUP (SHOVE INIT) ---
            // ===================================
            // This now runs for ALL classes
            if (!playerShoveStates[playerId]) {

                // --- LIVE CLASS STATS RETRIEVAL (The proven working method) ---
                let maxStamina: number;
                
                if (mod.IsSoldierClass(player, mod.SoldierClass.Engineer)) {
                    maxStamina = ENGINEER_SHOVE_STATS.maxStamina;
                } else if (mod.IsSoldierClass(player, mod.SoldierClass.Assault)) {
                    maxStamina = ASSAULT_SHOVE_STATS.maxStamina;
                } else if (mod.IsSoldierClass(player, mod.SoldierClass.Recon)) {
                    maxStamina = RECON_SHOVE_STATS.maxStamina;
                } else {
                    // Default/Fallback (This will catch Support)
                    maxStamina = DEFAULT_SHOVE_STATS.maxStamina;
                }
                // ------------------------------------

                playerShoveStates[playerId] = {
                    currentStamina: maxStamina,
                    lastShoveTime: currentTime,
                    isRestricted: false,
                    isCurrentlyMeleeing: false
                };
            }
        
        } // End if(zPlayer)
    } // End else (Human Player)
}
async function showLoreIntro() {
    console.log("Showing lore intro...");
    // Array of text chunks to display progressively
    const textChunks = [
        mod.stringkeys.lore_chunk1,
        mod.stringkeys.lore_chunk2,
        mod.stringkeys.lore_chunk3,
        mod.stringkeys.lore_chunk4,
        mod.stringkeys.lore_chunk5,
        mod.stringkeys.lore_chunk6,
        mod.stringkeys.lore_chunk7
    ];
    
    let uiWidgets: {[key: number]: {bg: any, title: any, timestamp: any, text: any}} = {};
    
    // Create UI containers for all players
    for (let id in ZombiePlayer.allPlayers) {
        let zPlayer = ZombiePlayer.allPlayers[id];
        
        // Create fullscreen dark overlay
        mod.AddUIContainer(
            "lore_bg_" + zPlayer.playerId,
            mod.CreateVector(0, 0, 0),
            mod.CreateVector(1920, 1080, 0),
            mod.UIAnchor.Center,
            mod.GetUIRoot(),
            true,
            0,
            mod.CreateVector(0, 0, 0),
            0.95,
            mod.UIBgFill.Solid,
            mod.UIDepth.AboveGameUI,
            zPlayer.player
        );
        
        // Create classified header
        mod.AddUIText(
            "lore_title_" + zPlayer.playerId,
            mod.CreateVector(0, -200, 0),
            mod.CreateVector(700, 60, 0),
            mod.UIAnchor.Center,
            mod.GetUIRoot(),
            true,
            10,
            mod.CreateVector(0.1, 0, 0),
            0.8,
            mod.UIBgFill.Solid,
            mod.Message(mod.stringkeys.lore_title),
            36,
            mod.CreateVector(1, 0.2, 0.2),
            1,
            mod.UIAnchor.Center,
            mod.UIDepth.AboveGameUI,
            zPlayer.player
        );
        
        // Create timestamp
        mod.AddUIText(
            "lore_timestamp_" + zPlayer.playerId,
            mod.CreateVector(0, 200, 0),
            mod.CreateVector(600, 40, 0),
            mod.UIAnchor.Center,
            mod.GetUIRoot(),
            true,
            10,
            mod.CreateVector(0, 0, 0),
            0,
            mod.UIBgFill.None,
            mod.Message(mod.stringkeys.lore_timestamp),
            20,
            mod.CreateVector(0.7, 0.7, 0.7),
            1,
            mod.UIAnchor.Center,
            mod.UIDepth.AboveGameUI,
            zPlayer.player
        );
        
        // Create text container (will be updated line by line)
        mod.AddUIText(
            "lore_text_" + zPlayer.playerId,
            mod.CreateVector(0, 0, 0),
            mod.CreateVector(900, 500, 0),
            mod.UIAnchor.Center,
            mod.GetUIRoot(),
            true,
            20,
            mod.CreateVector(0, 0, 0),
            0,
            mod.UIBgFill.None,
            mod.Message(""),
            24,
            mod.CreateVector(0.9, 0.9, 0.9),
            1,
            mod.UIAnchor.Center,
            mod.UIDepth.AboveGameUI,
            zPlayer.player
        );
        
        // Store widget references
        uiWidgets[zPlayer.playerId] = {
            bg: mod.FindUIWidgetWithName("lore_bg_" + zPlayer.playerId),
            title: mod.FindUIWidgetWithName("lore_title_" + zPlayer.playerId),
            timestamp: mod.FindUIWidgetWithName("lore_timestamp_" + zPlayer.playerId),
            text: mod.FindUIWidgetWithName("lore_text_" + zPlayer.playerId)
        };
    }
    
    // Progressive reveal - show each chunk with delay
    for (let i = 0; i < textChunks.length; i++) {
        for (let id in ZombiePlayer.allPlayers) {
            let zPlayer = ZombiePlayer.allPlayers[id];
            if (uiWidgets[zPlayer.playerId] && uiWidgets[zPlayer.playerId].text) {
                mod.SetUITextLabel(uiWidgets[zPlayer.playerId].text, mod.Message(textChunks[i]));
            }
        }
        
        await mod.Wait(1.5); // 1.5 seconds between lines
    }
    
    // Hold final text for 3 seconds
    await mod.Wait(3);
    
    console.log("Deleting lore UI...");
    
    // Remove lore UI using stored references
    for (let playerId in uiWidgets) {
        let widgets = uiWidgets[playerId];
        
        if (widgets.bg) {
            mod.DeleteUIWidget(widgets.bg);
            console.log("Deleted bg for player ", playerId);
        }
        if (widgets.title) {
            mod.DeleteUIWidget(widgets.title);
            console.log("Deleted title for player ", playerId);
        }
        if (widgets.timestamp) {
            mod.DeleteUIWidget(widgets.timestamp);
            console.log("Deleted timestamp for player ", playerId);
        }
        if (widgets.text) {
            mod.DeleteUIWidget(widgets.text);
            console.log("Deleted text for player ", playerId);
        }
    }
    
    console.log("Lore intro complete. Starting wave 1...");
}
export function OnPlayerUndeploy(player: mod.Player) {
    if (!mod.IsPlayerValid(player)) {
        console.log("OnPlayerUndeploy called with invalid player, ignoring");
        return;
    }
    const playerID = mod.GetObjId(player);
    let isAI = mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier);

    // ============================================
    // 1. ZOMBIE SPECIALIST CLEANUP
    // ============================================

    // --- SMOKER PULL CLEANUP ---
    // If the undeploying player is the active Smoker Puller.
    if (smokerPullActive && isAI && playerID === smokerPullerId) {
        console.log(`Smoker Puller (ID: ${playerID}) undeployed. Terminating pull.`);
        // This function resets the global flags (smokerPullActive, pulledPlayerId, smokerPullerId)
        endSmokerPull(); 
    }

    // --- HUNTER POUNCE CLEANUP ---
    // This assumes your Hunter logic tracks the active pouncers in a map named 'hunterPounceStates', 
    // where the key is the Hunter's ID.
    if (isAI && hunterPounceStates[playerID]) {
        console.log(`Hunter Pouncer (ID: ${playerID}) undeployed. Terminating pounce.`);
        
        endHunterPounce();
        
        // Remove this specific Hunter's active state from the map
        delete hunterPounceStates[playerID]; 
        
        // OPTIONAL: If the Hunter was the LAST active pouncer, you should reset the global flag:
        //if (Object.keys(hunterPounceStates).length === 0) {
             //isHunterPounceActive = false;
         //}
    }
    
    if (isAI) {

        // Zombie tried to redeploy - count it as dead and respawn immediately
        let zombie = Zombie.get(player);
        if (zombie) {
            console.log("Zombie ", zombie.playerId, " redeployed (suicide). Counting as death and respawning.");

            // --- NEW CLEANUP LOGIC ---
            if (zombie.isSmokerZombie) {
                smokersAlive--;
                specialsAlive--; // <--- NEW DECREMENT
                smokerZombieIds.delete(zombie.playerId);
                // General custom zombie cleanup
                Zombie.remove(zombie.playerId);
                // 2. Start the cooldown timer
                //startSmokerRespawnCooldown();
                console.log(`Cleaned up Smoker ID ${zombie.playerId} from undeploy.`);
            }
            if (zombie.isHunterZombie) {
                huntersAlive--;
                specialsAlive--; // <--- NEW DECREMENT
                hunterZombieIds.delete(zombie.playerId);
                // General custom zombie cleanup
                Zombie.remove(zombie.playerId);
                delete hunterPounceStates[zombie.playerId];
                console.log(`Cleaned up Hunter ID ${zombie.playerId} from undeploy.`);
            }
            // --- END NEW CLEANUP ---
            
            zombiesAlive--;
            Zombie.remove(zombie.playerId);
            
            // Don't decrement zombiesRemaining - this wasn't a real kill
            // Respawn a new zombie immediately to replace the one that killed itself
            if (roundActive) {
                let spawnerId = 100 + Math.floor(Math.random() * 20) + 1;
                let spawner = mod.GetSpawner(spawnerId);
                //mod.SpawnAIFromAISpawner(spawner, mod.SoldierClass.Assault, mod.GetTeam(1));
            }
        }
    }
}
export function OnMandown(victim: mod.Player, attacker: mod.Player) {
    let victimIsAI = mod.GetSoldierState(victim, mod.SoldierStateBool.IsAISoldier);
    
    if (!victimIsAI) {
        // Player went into mandown
        let zPlayer = ZombiePlayer.get(victim);
        if (zPlayer) {
            zPlayer.isAlive = false; // Mark as down (not alive)
            
            // Check if all players are down
            if (areAllPlayersDead()) {
                triggerGameOver();
            } else {
                // Notify downed player and teammates
                mod.DisplayNotificationMessage(
                    mod.Message(mod.stringkeys.player_down),
                    victim
                );
            }
        }
    }
}
export function OnRevived(victim: mod.Player, reviver: mod.Player) {
    let zPlayer = ZombiePlayer.get(victim);
    if (zPlayer) {
        zPlayer.isAlive = true; // Mark as alive again
        
        mod.DisplayNotificationMessage(
            mod.Message(mod.stringkeys.player_revived),
            victim
        );
    

        }
    }
export function OnPlayerDied(
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
) {
        console.log("=== DEATH CALLED === Victim ID: ", mod.GetObjId(victim), " zombiesAlive: ", zombiesAlive, " zombiesRemaining: ", zombiesRemaining);
    const victimId = mod.GetObjId(victim);
    let victimIsAI = mod.GetSoldierState(victim, mod.SoldierStateBool.IsAISoldier);
    const zpInstance = ZombiePlayer.allPlayers[victimId];
    // --- CRITICAL STEP: Get the count of alive humans BEFORE this death is processed ---
    // If this function returns 1, the victim is the last human.
    //const aliveCount = getAliveHumanPlayerCount(); 
    //const isLastHuman = aliveCount <= 1;

    // --- PULL TERMINATION CHECKS (Highest Priority) ---

    // SCENARIO 1: VICTIM IS THE PULLED HUMAN PLAYER 
    if (smokerPullActive && !victimIsAI && victimId === pulledPlayerId) {
        
        console.log("Pulled player died. Terminating pull and starting ammo cooldown.");
        const pullerSmokerId = smokerPullerId; // Store before reset
        
        endSmokerPull(); 
        
        smokerAmmoCooldownEndTime = mod.GetMatchTimeElapsed() + SMOKER_AMMO_COOLDOWN_SECONDS;
        smokerIdAwaitingAmmo = pullerSmokerId; 
        
        // Return only if other humans are still alive (triggering the man-down/disabled state).
        //if (!isLastHuman) {
           // --- ADDED FIX ---
        // Stop execution here. The player is dead, but all cleanup is handled
        // by endSmokerPull() and the normal respawn flow.
        return;
        }
    //}
    
    // SCENARIO 2: VICTIM IS THE PULLER SMOKER
    if (smokerPullActive && victimIsAI && victimId === smokerPullerId) {
        console.log("Puller Smoker died. Terminating pull immediately from OnPlayerDied.");
        endSmokerPull(); 
        // FALL THROUGH: Continue to cleanup block below to remove Smoker's ID from maps.
    }

    // --- NEW: HUNTER POUNCE TERMINATION CHECKS ---
    // SCENARIO 1.5: VICTIM IS THE POUNCED HUMAN PLAYER
    if (isHunterPounceActive && !victimIsAI && victimId === pouncedPlayerId) {
        console.log("Pounced player died. Terminating pounce.");
        endHunterPounce();
        
        // Return only if other humans are still alive (triggering the man-down/disabled state).
        //if (!isLastHuman) {
            // --- ADDED FIX ---
        // Stop execution here. The player is dead, but all cleanup is handled
        // by endSmokerPull() and the normal respawn flow.
        return;
        }
    //}
    
    // SCENARIO 2.5: VICTIM IS THE POUNCER HUNTER
    if (isHunterPounceActive && victimIsAI && victimId === hunterPouncerId) {
        console.log("Pouncer Hunter died. Terminating pounce immediately.");
        endHunterPounce();
        // FALL THROUGH to AI cleanup
    }
    
if (victimIsAI) {
    let victimId = mod.GetObjId(victim);
    delete zombieSlapCooldowns[victimId]; 
    delete zombieSlapWindups[victimId];
    delete zombieLeapCooldowns[victimId]; 
    delete zombieBoostCooldowns[victimId];
    delete zombieLeapWindups[victimId];
    delete zombieStunTimers[victimId];
    delete zombiePreviousHealth[victimId];
    delete zombieLastDamageTime[victimId]; 
    delete zombieLastTargetUpdate[victimId];
    delete zombieLastPosition[victimId];
    delete hunterPounceStates[victimId]; 
    let zombie = Zombie.get(victim);
    if (zombie && mod.IsPlayerValid(killer)) {

// Capture the ID of the Smoker pulling, as endSmokerPull will reset smokerPullerId
    let pullerSmokerId = smokerPullerId; 
    
    // Check if the victim was the player being pulled and a pull was active
    if (smokerPullActive && mod.GetObjId(victim) === pulledPlayerId) {
        
        endSmokerPull(); // This resets pull state flags
        
        // --- NEW: Start the Smoker Ammo Cooldown ---
        smokerAmmoCooldownEndTime = mod.GetMatchTimeElapsed() + SMOKER_AMMO_COOLDOWN_SECONDS;
        smokerIdAwaitingAmmo = pullerSmokerId; // Store the Smoker's ID who needs ammo
        
        console.log(`Pulled player died. Smoker (ID: ${pullerSmokerId}) ammo cooldown started. Ends at: ${smokerAmmoCooldownEndTime.toFixed(2)}s`);
    }

    if (zombie) {
        // --- NEW SMOKER CLEANUP ---
            if (zombie.isSmokerZombie) {
                smokersAlive--; // Decrement the global counter
                specialsAlive--; // <--- NEW DECREMENT           
                smokerZombieIds.delete(victimId);
                // General custom zombie cleanup
                Zombie.remove(zombie.playerId);
                // 2. Start the cooldown timer
                startSmokerRespawnCooldown();
                console.log("Smoker zombie killed. Smokers alive remaining: ", smokersAlive);
            }

            // --- NEW: HUNTER CLEANUP ---
            if (zombie.isHunterZombie) {
                huntersAlive--;
                specialsAlive--; // <--- NEW DECREMENT
                hunterZombieIds.delete(victimId);
                // General custom zombie cleanup
                Zombie.remove(zombie.playerId);
                delete hunterPounceStates[victimId]; // Clean up state machine
                console.log("Hunter died. Cleaned up ID: ", victimId);
                // Note: Pounce cooldown is global, not tied to a specific Hunter's death.
            }
    }
        let killerId = mod.GetObjId(killer);
            
            // Normal zombie death logic
            let isHeadshotKill = mod.EventDeathTypeCompare(deathType, mod.PlayerDeathTypes.Headshot);
            
            let zPlayer = ZombiePlayer.get(killer);
            if (zPlayer) {
                if (isHeadshotKill) {
                } else {
                }
                zPlayer.kills++;
            }
            
            zombiesAlive--;
            //zombiesRemaining--;
            
            let deathPos = mod.GetSoldierState(victim, mod.SoldierStateVector.GetPosition);
            
            delete zombieLastTargetUpdate[zombie.playerId];
            Zombie.remove(zombie.playerId);
            
            updateAllPlayerUI();
            
            if (zombiesRemaining <= 0 && roundActive) {
                endWave();
            }
        }
    } else {
        // Player died
        let victimId = mod.GetObjId(victim);
        //delete playerWeapons[victimId];
        //delete playerPrimaryWeapon[victimId];
        //delete playerSecondaryWeapon[victimId];
        //delete playerMeleeWeapon[victimId];
        delete playerShoveStates[victimId]; // <-- ADD THIS
        if (playerReloadTracking[victimId]) {
            delete playerReloadTracking[victimId];
        }
        // Cleanup Engineer State
        if (engineerStates[victimId]) {
             delete engineerStates[victimId];
        }

        // Cleanup Engineer UI
        if (zpInstance) {
            // Call the new global function
            destroyEngineerUI(zpInstance);
        }

        // Cleanup Support State (Ammo Bonus)
    if (supportStates[victimId]) { // <-- NEW CLEANUP
         delete supportStates[victimId];
    }
    // 1. Remove core player object (The one containing playerClassId)
        delete ZombiePlayer.allPlayers[victimId];
        console.log("Cleared all weapon PaP data (primary, secondary, melee) for player ", victimId);
        
        let zPlayer = ZombiePlayer.get(victim);
        if (zPlayer) {
            zPlayer.isAlive = false;
            zPlayer.deaths++;
            
            if (areAllPlayersDead()) {
                triggerGameOver();
            }
        }
    }
}
async function triggerGameOver() {
    if (gameOver) return; // Prevent multiple triggers
    despawnAllZombies();
    endWave();
    
    gameOver = true;
    roundActive = false;
    //maxAmmoEventActive = false;
    //maxAmmoZombiesRemaining = 0;
    //maxAmmoZombieIds.clear();
    smokerZombieIds.clear();
    hunterZombieIds.clear();
    disabledPlayerIds.clear();
    activeSpawnerIds.clear();
    console.log("Game Over! Wave reached: ", currentWave);
    
    
    // Show game over to all players
    for (let id in ZombiePlayer.allPlayers) {
        let zPlayer = ZombiePlayer.allPlayers[id];
    
        // Show stats screen
        if (mod.IsPlayerValid(zPlayer.player)) {
            mod.EnableAllInputRestrictions(zPlayer.player, true);
        }
    }
    
    // End the game mode (this will reload the map)
    console.log("Ending game mode to reload map...");
    mod.EndGameMode(mod.GetTeam(1)); // Team 0 = draw/no winner, triggers map reload
    await mod.Wait(10);
}

function despawnAllZombies() {
    // Kill all zombie AI
    for (const idStr in Zombie.allZombies) {
        const zombieIdalt = parseInt(idStr);
    for (let zombieId in Zombie.allZombies) {
        let zombie = Zombie.allZombies[zombieId];
        if (zombie && zombie.player && mod.IsPlayerValid(zombie.player)) {
            mod.Kill(zombie.player);
            Zombie.remove(parseInt(zombieId));
            delete Zombie.allZombies[idStr];
            delete zombieStunTimers[zombieIdalt];
            delete zombieLastDamageTime[zombieIdalt]; 
            delete zombieSlapWindups[zombieIdalt];
            delete zombieLeapCooldowns[zombieIdalt];
            delete zombieLeapWindups[zombieIdalt];
            delete zombieLastTargetUpdate[zombieIdalt];
            delete zombieLastPosition[zombieIdalt];
            delete zombiePreviousHealth[zombieIdalt];
            delete zombieBoostCooldowns[zombieIdalt];
            delete zombieSlapCooldowns[zombieIdalt];
            delete hunterPounceStates[zombieIdalt];
        
        // --- NEW CRITICAL HUNTER/SMOKER/MAX AMMO CLEANUP ---
        smokerZombieIds.delete(zombieIdalt);
        hunterZombieIds.delete(zombieIdalt);
        Zombie.remove(zombieIdalt);
        }
    }
    
    // Clear the entire zombie registry
    //Zombie.allZombies = {};
    
    // Reset counters
    zombiesAlive = 0;
    zombiesRemaining = 0;
    
    console.log("All zombies despawned and tracking cleared");
}
}

export function OngoingGlobal() {
    if (!gameStarted) {
        return;
    }
    let currentTime = mod.GetMatchTimeElapsed();
    shovesRequestedThisTick = {}; // <-- CLEAR THE REQUEST MAP
    // Define this array once at the top of your script alongside other constants
    const RELOAD_SLOTS = [
    mod.InventorySlots.PrimaryWeapon, 
    mod.InventorySlots.SecondaryWeapon
];

    // --- SMOKER COOLDOWN COMPLETION CHECK ---
    if (isSmokerOnCooldown) {
        
        // Check if the current time has passed the calculated end time
        if (currentTime >= smokerCooldownEndTime) {
            // Cooldown finished! Grant the token and reset state.
            isSmokerOnCooldown = false;
            smokerCooldownStartTime = 0;
            smokerCooldownEndTime = 0;
            
            console.log("Smoker respawn cooldown finished via OngoingGlobal check. Token granted.");
        }
    }
    // ------------------------------------------

    // --- NEW: HUNTER POUNCE COOLDOWN CHECK ---
    if (isHunterPounceOnCooldown && currentTime >= hunterPounceCooldownEndTime) {
        isHunterPounceOnCooldown = false;
        console.log("Hunter pounce is OFF cooldown.");
    }

    // --- NEW: SMOKER AMMO RESTORATION CHECK ---
    // Check if the timer has been set AND the current time has passed the end time
    if (smokerIdAwaitingAmmo !== 0 && currentTime >= smokerAmmoCooldownEndTime) {
        
        const smokerPlayer = Zombie.allZombies[smokerIdAwaitingAmmo]?.player;

        if (mod.IsPlayerValid(smokerPlayer)) {
            // Give back 1 round of reserve ammo
            mod.SetInventoryMagazineAmmo(smokerPlayer, mod.InventorySlots.PrimaryWeapon, 1);
            console.log(`Smoker (ID: ${smokerIdAwaitingAmmo}) ammo restored.`);
        }
        
        // Reset the state regardless of whether the player was found (timer is done)
        smokerAmmoCooldownEndTime = 0;
        smokerIdAwaitingAmmo = 0;
    }
    // ------------------------------------------

// ==========================================================
// --- TOP-LEVEL DEAD PLAYER CLEANUP (Crash Defense & Status Update) ---
// ==========================================================
for (const idStr in ZombiePlayer.allPlayers) {
    const playerId = parseInt(idStr);
    // Note: 'player' is the mod.Player object, which becomes invalid when they die/undeploy.
    const pObj = ZombiePlayer.allPlayers[idStr];
    const player = pObj.player; 
    
    // ... (CRITICAL CRASH FIX & GLOBAL CLEANUP) ...
    if (!player || !mod.IsPlayerValid(player)) {
        
        // 1. Retrieve the ZombiePlayer object using the ID (since the player object is invalid)
        // Assuming ZombiePlayer.get(playerId) works or you can use ZombiePlayer.allPlayers[idStr]
        let zPlayer = ZombiePlayer.get(player); 

        if (zPlayer) {
            // A. PLAYER STATUS UPDATE (Your requested logic, only if not already marked dead)
            if (zPlayer.isAlive) { 
                zPlayer.isAlive = false;
                zPlayer.deaths++;
                
                // B. GAME OVER CHECK
                if (areAllPlayersDead()) {
                    triggerGameOver();
                }
                console.log(`OngoingGlobal detected death of player ${playerId} and updated status.`);
            }

            // 2. Clean up player-specific tracking maps (General Crash Prevention)
            delete playerShoveStates[playerId];
            delete playerReloadTracking[playerId];
            delete engineerStates[playerId];
            destroyEngineerUI(pObj);
            delete supportStates[playerId];
            disabledPlayerIds.delete(playerId);
            disabledPlayerIds.delete(pouncedPlayerId);
            disabledPlayerIds.delete(pulledPlayerId);
            // Add any other player state maps here:
            // delete playerReloadTracking[playerId]; 
            
            // 3. Clean up Special Infected Locks (Hunter Kill Crash Prevention)
            if (isHunterPounceActive && pouncedPlayerId === playerId) {
                endHunterPounce(); // Terminate the pounce state immediately
                disabledPlayerIds.delete(pouncedPlayerId);
                disabledPlayerIds.delete(playerId);
            }
            if (smokerPullActive && pulledPlayerId === playerId) {
                endSmokerPull(); // Terminate the pull state immediately
                disabledPlayerIds.delete(pulledPlayerId);
                disabledPlayerIds.delete(playerId);
            }
        }
        
        // 4. Remove the player from the master tracker (always done last)
        delete ZombiePlayer.allPlayers[idStr];
        disabledPlayerIds.delete(pouncedPlayerId);
        disabledPlayerIds.delete(pulledPlayerId);
        disabledPlayerIds.delete(playerId);
        console.log(`Global Cleanup: Removing dead human player ID ${playerId} from all trackers.`);
    }
}

    // --- SMOKER PULL ACTION LOOP (The new SetInterval replacement) ---
    if (smokerPullActive) {
        // 2. TIME-GATED PULL ACTION (Only runs every 0.75s)
        if (currentTime >= smokerLastPullTime + PULL_DURATION_SECONDS) {

            // Retrieve objects again (essential for validation)
        const currentSmoker = Zombie.allZombies[smokerPullerId]?.player;
        const currentPlayer = ZombiePlayer.allPlayers[pulledPlayerId]?.player;
        const MERCY_HEALTH_THRESHOLD = 15;

        // Validate (OnPlayerDied should catch this, but good safety check)
            if (!mod.IsPlayerValid(currentSmoker) || !mod.IsPlayerValid(currentPlayer)) {
                endSmokerPull();
                // Stops any further code in this specific 0.75s tick from running on the dead player.
                //return;
            } else {
            // Apply the Damage and Move logic (Only if valid)
            
            const currentHealth = mod.GetSoldierState(currentPlayer, mod.SoldierStateNumber.CurrentHealth); // Get player's current health

            // *** MERCY RULE CONDITION ADDED ***
            if (currentHealth <= MERCY_HEALTH_THRESHOLD) {
                // Apply Damage: Only if the player is above the threshold
                mod.DealDamage(currentPlayer, SMOKER_PULL_DAMAGE, currentSmoker); 
                
                // POST-DAMAGE CHECK: Check if the damage was lethal and clean up
                if (!mod.IsPlayerValid(currentPlayer)) {
                    endSmokerPull(); 
                }
            } 
            // ELSE: If health is <= 14, damage is skipped, but the pull continues.

            // The move logic and timer reset must be done if the pull state is still active.
            if (smokerPullActive) { 
                mod.SetObjectTransformOverTime(currentPlayer, mod.GetObjectTransform(currentSmoker),PULL_MOVE_TIME,false,false)
                
                // --- Reset the timer for the next iteration ---
                smokerLastPullTime = currentTime; 
                
                console.log("Smoker pull action executed. Next action at: " + (currentTime + PULL_DURATION_SECONDS).toFixed(2) + "s");
            }
        }
    }
    }

    // --- NEW: HUNTER POUNCE DAMAGE LOOP (if pounce is active) ---
    if (isHunterPounceActive) {
        // Check if 0.5 seconds have passed
        if (currentTime >= hunterPounceLastDamageTime + HUNTER_POUNCE_DAMAGE_INTERVAL) {
            
            const hunter = Zombie.allZombies[hunterPouncerId]?.player;
            const victim = ZombiePlayer.allPlayers[pouncedPlayerId]?.player;

            // Validate (OnPlayerDied should catch this, but good safety check)
            if (!mod.IsPlayerValid(hunter) || !mod.IsPlayerValid(victim)) {
                endHunterPounce();
                // Stops any further code in this specific 0.75s tick from running on the dead player.
                //return;
            } else {

                const currentHealth = mod.GetSoldierState(victim, mod.SoldierStateNumber.CurrentHealth); // Get player's current health

                // *** MERCY RULE CONDITION ADDED ***
                if (currentHealth <= 18) {
                // Apply Damage: Only if the player is above the threshold
                mod.DealDamage(victim, HUNTER_POUNCE_DAMAGE, hunter);
                // POST-DAMAGE CHECK: Check if the damage was lethal and clean up
                if (!mod.IsPlayerValid(victim)) {
                    endHunterPounce(); 
                }
            } 
                // The move logic and timer reset must be done if the pull state is still active.
            if (isHunterPounceActive) {
                // Pull Hunter to player (as requested)
                const victimPos = mod.GetSoldierState(victim, mod.SoldierStateVector.GetPosition);
                mod.SetObjectTransformOverTime(hunter, mod.GetObjectTransform(victim),POUNCE_MOVE_TIME,false,false)
                
                // Reset timer
                hunterPounceLastDamageTime = currentTime;

                console.log("Hunter pounce action executed. Next action at: " + (currentTime + HUNTER_POUNCE_DAMAGE_INTERVAL).toFixed(2) + "s");
            }
        }
    }
}
    // --------------------------------------------------------

    // ============================================
    // --- NEW: HUNTER POUNCE STATE MACHINE ---
    // Manages Stalking and Leaping states
    // ============================================

    // 1. POUNCE TRIGGER (Find a Hunter to start 'stalking')
    // Check if pounce is available (no global lock, not on cooldown)
    if (!isHunterPounceActive && !isHunterPounceOnCooldown) {
        // Check if 2-second scan interval has passed
        if (currentTime > hunterLastPounceCheckTime + HUNTER_POUNCE_CHECK_INTERVAL) {
            
            // 15% chance to trigger a scan
            if (Math.random() < HUNTER_POUNCE_TRIGGER_CHANCE) {
                // Find one available Hunter and one target
                for (const hunterId of hunterZombieIds) {
                    const hunterState = hunterPounceStates[hunterId];
                    // Find a Hunter that is 'idle' (not stalking, leaping, or pinned)
                    if (!hunterState || hunterState.state === 'idle') {
                        const hunter = Zombie.allZombies[hunterId]?.player;
                        if (!mod.IsPlayerValid(hunter)) continue;

                        const hunterPos = mod.GetSoldierState(hunter, mod.SoldierStateVector.GetPosition);
                        
                        // Find nearest player within 8m (2D distance)
                        const target = findNearestPlayer(hunterPos);
                        if (target) {
                            const targetId = mod.GetObjId(target);
                            // NEW FIX: Skip if the target is already disabled by another infected
                            if (disabledPlayerIds.has(targetId)) {
                                continue; // Go to the next potential target
                            }
                            const targetPos = mod.GetSoldierState(target, mod.SoldierStateVector.GetPosition);
                            const distance2D = CustomVectorDistance2D(hunterPos, targetPos);

                            if (distance2D <= HUNTER_POUNCE_RANGE_2D) {
                                // --- TARGET FOUND! START STALKING ---
                                console.log(`Hunter ${hunterId} starting pounce STALK on player ${mod.GetObjId(target)}`);
                                // Set Hunter to crouch/stand still
                                mod.AISetMoveSpeed(hunter, mod.MoveSpeed.InvestigateWalk);
                                mod.SetPlayerMovementSpeedMultiplier(hunter, 1.25);
                                mod.AISetStance(hunter, mod.Stance.Crouch);
                                // Set state
                                hunterPounceStates[hunterId] = {
                                    state: 'stalking',
                                    targetId: mod.GetObjId(target),
                                    startTime: currentTime,
                                    leapTargetPos: ZEROVEC // Not yet known
                                };
                                // Start the 90-second global cooldown NOW
                                isHunterPounceOnCooldown = true;
                                hunterPounceCooldownEndTime = currentTime + HUNTER_POUNCE_COOLDOWN_SECONDS;
                                
                                // Break: Only one Hunter can start stalking per scan
                                break; 
                            }
                        }
                    }
                }
            }
            // Reset scan timer regardless of success
            hunterLastPounceCheckTime = currentTime;
        }
    }

    // 2. POUNCE STATE MACHINE (Process active Hunters)
    for (const hunterIdStr in hunterPounceStates) {
        const hunterId = parseInt(hunterIdStr);
        const stateData = hunterPounceStates[hunterId];
        const hunter = Zombie.allZombies[hunterId]?.player;
        const target = ZombiePlayer.allPlayers[stateData.targetId]?.player;

        if (!mod.IsPlayerValid(hunter) || !mod.IsPlayerValid(target)) {
            // Hunter or target died/left, clean up state
            delete hunterPounceStates[hunterId];
            continue;
        }

        switch (stateData.state) {
            case 'stalking':
                // Check if 3-second windup is over
                if (currentTime > stateData.startTime + HUNTER_POUNCE_WINDUP_SECONDS) {
                    console.log(`Hunter ${hunterId} LEAPING at player ${stateData.targetId}`);
                    
                    // --- REPLACE LEAP LOGIC HERE ---
                    // FIX: Call the new asynchronous function instead of a single move command
                    performHunterLeap(hunter, target, stateData.targetId);
                    
                    // Update state to 'leaping'
                    stateData.state = 'leaping';
                    stateData.startTime = currentTime; // Reset start time to track leap duration
                }
                break;

            case 'leaping':
                // Check if Hunter connected with the target
                const hunterPos = mod.GetSoldierState(hunter, mod.SoldierStateVector.GetPosition);
                const targetPos = mod.GetSoldierState(target, mod.SoldierStateVector.GetPosition);
                const distance = mod.DistanceBetween(hunterPos, targetPos);

                if (distance <= HUNTER_POUNCE_PIN_RANGE) {
                    // --- PINNED! ---
                    // Check if another pounce just got locked (race condition)
                    if (isHunterPounceActive) {
                        // Another Hunter got the pin, this one missed.
                        delete hunterPounceStates[hunterId];
                        mod.AISetMoveSpeed(hunter, mod.MoveSpeed.InvestigateRun); // Go back to normal
                        mod.AISetStance(hunter, mod.Stance.Stand);
                        mod.SetPlayerMovementSpeedMultiplier(hunter, 1.5);
                    } else {
                        // This Hunter gets the pin!
                        stateData.state = 'pinned';
                        startHunterPounce(hunter, target);
                    }
                } 
                // Check if leap timed out (missed)
                else if (currentTime > stateData.startTime + (HUNTER_POUNCE_LEAP_DURATION + 0.5)) { // 1.5s total
                    console.log(`Hunter ${hunterId} leap missed.`);
                    delete hunterPounceStates[hunterId];
                    // Reset AI to default
                    mod.AISetMoveSpeed(hunter, mod.MoveSpeed.InvestigateRun);
                    mod.AISetStance(hunter, mod.Stance.Stand);
                    mod.SetPlayerMovementSpeedMultiplier(hunter, 1.5);
                }
                break;
            
            case 'pinned':
                // This state is managed by the global 'isHunterPounceActive' loop
                // and terminated by OnPlayerDied or endHunterPounce()
                break;
        }
    }
    // --------------------------------------------------------
    
    if (!roundActive && !maxAmmoEventActive) {
        return;
    }

    // --- ZOMBIE AI UPDATE & HEALTH CHECK LOOP ---
    for (const idStr in ZombiePlayer.allPlayers) {
    for (let playerId in ZombiePlayer.allPlayers) {
        let zombiePlayer = ZombiePlayer.allPlayers[playerId];
        const zPlayer = ZombiePlayer.allPlayers[idStr];

        // STEP 1: FAST FILTER - Check if our custom data object exists
    if (!zPlayer) {
        delete ZombiePlayer.allPlayers[idStr]; 
        continue;
    }
    
    const player = zPlayer.player;
    // Example: Authoritative check for aliveness
    const isAlive = mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive);

    // STEP 2: STALE ENGINE OBJECT VALIDATION - Check if the engine object is valid
    if (!mod.IsPlayerValid(player)) {
        delete ZombiePlayer.allPlayers[idStr]; 
        continue; 
    }

    // --- CRITICAL SAFETY NET: WRAP ALL CODE THAT TOUCHES THE ENGINE OBJECT ---
    try {
        
        // ** START OF YOUR ZOMBIE AI / HEALTH CHECK LOGIC **
        
        if (!isAlive) {
            // Cleanup the dead player immediately
            delete ZombiePlayer.allPlayers[idStr];
            continue;
        }

        if (mod.IsPlayerValid(player)) {
            
            // 1. Store the CURRENT health into the PREVIOUS health variable
            zombiePlayer.previousHealth = zombiePlayer.currentHealth;
            
            // 2. Get the new health
            let newHealth = mod.GetSoldierState(player, mod.SoldierStateNumber.CurrentHealth);
            
            // 3. Update the CURRENT health for next tick's comparison
            zombiePlayer.currentHealth = newHealth; 
            
            // 4. Calculate the health drop from this tick
            const healthDrop = zombiePlayer.previousHealth - newHealth;

            // --- SMOKER PULL INITIATION CHECK ---
            if (!smokerPullActive) {
                //const currentTime = mod.GetMatchTimeElapsed(); 
                const currentPlayerId = mod.GetObjId(player);

                // 1. CRITICAL GRACE PERIOD CHECK: 
                // Check if the current time is less than the grace period end time
                // AND if the player is the one who was just pulled.
                if (currentTime < smokerPullGracePeriodEndTime) {
                if (currentPlayerId === lastPulledPlayerId) {
                    continue; // Ignore any trigger on this specific player
                }
                // Also enforce the global grace period if no player-specific check was hit
                if (lastPulledPlayerId === 0) {
                    continue; // Global lock is active
                }
                }
                // A. Check if the exact damage amount was dealt
                if (healthDrop === SMOKER_PULL_DAMAGE_CHEST || healthDrop === SMOKER_PULL_DAMAGE_BODY) {

                    // --- ADDED FIX ---
                    // If the player's new health is 0 or less, they died from this shot. DO NOT start a pull.
                    if (newHealth <= 12.799) {
                        console.log(`[PULL ABORTED] Player ${playerId} died from the initiating damage. Pull cancelled.`);
                        //continue; // Skip to the next player
                        // Stops any further code in this specific 0.75s tick from running on the dead player.
                        return;
                    }
                    // --- END FIX ---
                    
                    // B. Find the nearest Smoker to credit the damage
                    const killerSmoker = findNearestSmoker(player, SMOKER_PULL_RANGE);

                    if (killerSmoker) {
                        console.log(`Damage drop of ${healthDrop} detected. Crediting nearest Smoker.`);
                        // Manually initiate the pull sequence
                        startSmokerPull(player, killerSmoker);
                    }
                    }
            }
        } 
                    } catch (e) {
        // If any engine interaction (GetSoldierState, SetPlayerInfo, etc.) crashes
        // due to the player object being destroyed, this block catches it, 
        // cleans up the custom data, and allows the server to continue.
        // console.log(`Zombie AI system gracefully skipped player ${playerId} due to error.`);
        delete ZombiePlayer.allPlayers[idStr]; 
        continue;
                    }
                }
            }
    
    // Get all players and check for stuck zombies
    let allPlayers = mod.AllPlayers();
    let playerCount = mod.CountOf(allPlayers);
    let aliveZombieCount = 0;
    
    // ============================================
    // ZOMBIE WINDUP PROCESSING (Handle existing windups)
    // ============================================
    for (let i = 0; i < playerCount; i++) {
        let player = mod.ValueInArray(allPlayers, i) as mod.Player;
        
        if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) continue;
        if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)) continue;
        
        let zombieId = mod.GetObjId(player);
        let zombiePos = mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
        
        // Check if zombie is in windup state
        if (zombieSlapWindups[zombieId]) {
            let windupState = zombieSlapWindups[zombieId];
            let windupElapsed = currentTime - windupState.windupStartTime;
            let growlSFX: mod.SFX  | number = 0;
            
            // Play warning sound halfway through windup (only once)        
            if (!windupState.hasWarned && windupElapsed >= ZOMBIE_SLAP_WINDUP_TIME * 0.5) {
                // Find target player
                let targetPlayer: mod.Player | undefined;
                for (let j = 0; j < playerCount; j++) {
                    let p = mod.ValueInArray(allPlayers, j) as mod.Player;
                    if (mod.GetObjId(p) === windupState.targetPlayerId) {
                        targetPlayer = p;
                        break;
                    }
                }
                
                if (targetPlayer && mod.IsPlayerValid(targetPlayer)) {
                    growlSFX = mod.SpawnObject(
                        mod.RuntimeSpawn_Common.SFX_Alarm, 
                        zombiePos, 
                        mod.CreateVector(0, 0, 0),
                        mod.CreateVector(1, 1, 1)
                    );
                    // @ts-ignore
                    // @ts-ignore
                    mod.PlaySound(growlSFX, 80, mod.GetTeam(2)); 
                    
                    console.log("Zombie ", zombieId, " warning player ", windupState.targetPlayerId);
                }
                
                windupState.hasWarned = true;
            }
            
            // Check if windup is complete
            if (windupElapsed >= ZOMBIE_SLAP_WINDUP_TIME) {
                // @ts-ignore
                if (growlSFX) mod.StopSound(growlSFX);
                
                // Find target player
                let targetPlayer: mod.Player | undefined;
                for (let j = 0; j < playerCount; j++) {
                    let p = mod.ValueInArray(allPlayers, j) as mod.Player;
                    if (mod.GetObjId(p) === windupState.targetPlayerId) {
                        targetPlayer = p;
                        break;
                    }
                }
                
                // Verify target is still valid and in range
                if (targetPlayer && mod.IsPlayerValid(targetPlayer) && 
                    mod.GetSoldierState(targetPlayer, mod.SoldierStateBool.IsAlive)) {
                    
                    let humanPos = mod.GetSoldierState(targetPlayer, mod.SoldierStateVector.GetPosition);
                    let distance = mod.DistanceBetween(zombiePos, humanPos);
                    
                    // Still in range? Execute the slap!
                    if (distance <= ZOMBIE_SLAP_RANGE) {
                        // Calculate damage
                        let slapDamage = maxAmmoEventActive ? MAX_AMMO_ZOMBIE_DAMAGE : ZOMBIE_SLAP_DAMAGE;
                        
                        // Check if from behind
                        let humanFacing = mod.GetSoldierState(targetPlayer, mod.SoldierStateVector.GetFacingDirection);
                        let zombieToHuman = mod.DirectionTowards(zombiePos, humanPos);

                        let hitSFX: mod.SFX = mod.SpawnObject(
                            mod.RuntimeSpawn_Common.SFX_Alarm, 
                            zombiePos, 
                            mod.CreateVector(0, 0, 0),
                            mod.CreateVector(1, 1, 1)
                        );
                        mod.PlaySound(hitSFX, 80, mod.GetTeam(2));
                            
                        // Deal damage
                        mod.DealDamage(targetPlayer, slapDamage, player);
                        mod.StopSound(hitSFX);
                        
                        console.log("Zombie ", zombieId, " slapped player ", windupState.targetPlayerId, " for ", slapDamage, " damage");
                    } else {
                        console.log("Zombie ", zombieId, " windup complete but target out of range (", distance, "m)");
                    }
                }
                
                // CRITICAL: Clear windup FIRST, THEN set cooldown
                delete zombieSlapWindups[zombieId];
                zombieSlapCooldowns[zombieId] = currentTime; // Set cooldown to NOW
                
                console.log("Zombie ", zombieId, " slap complete - cooldown started at ", currentTime);
                
                // Resume normal movement after slap
                let nearestPlayer = findNearestPlayer(zombiePos);
                if (nearestPlayer) {
                    let targetPos = mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetPosition);
                    mod.AIMoveToBehavior(player, targetPos);
                    mod.AISetTarget(player, nearestPlayer);
                }
            } else {
                // Still winding up - freeze in place and face target
                //mod.AIIdleBehavior(player);
                
                // Find and face target
                for (let j = 0; j < playerCount; j++) {
                    let p = mod.ValueInArray(allPlayers, j) as mod.Player;
                    if (mod.GetObjId(p) === windupState.targetPlayerId) {
                        mod.AISetTarget(player, p);
                        break;
                    }
                }
            }
        }
    }
    
    // ============================================
    // ZOMBIE AI UPDATE & STUCK DETECTION
    // ============================================
    for (let i = 0; i < playerCount; i++) {
        let player = mod.ValueInArray(allPlayers, i) as mod.Player;
        const playerID = mod.GetObjId(player);
        let isAI = mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier);
        
        if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) continue;
        if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)) continue;
        
        aliveZombieCount++;
        
        let zombieId = mod.GetObjId(player);
        let zombiePos = mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
        
        // Skip AI updates if in windup
        if (zombieSlapWindups[zombieId]) {
            continue;
        }
        
        // Initialize tracking if first time seeing this zombie
        if (!zombieLastPosition[zombieId]) {
            zombieLastPosition[zombieId] = zombiePos;
            zombieLastDamageTime[zombieId] = currentTime;
        } else {
            // Check if zombie has moved
            let lastPos = zombieLastPosition[zombieId];
            let distanceMoved = mod.DistanceBetween(zombiePos, lastPos);
            
            if (distanceMoved > ZOMBIE_MOVE_THRESHOLD) {
                // Zombie moved - update position and reset timer
                zombieLastPosition[zombieId] = zombiePos;
                zombieLastDamageTime[zombieId] = currentTime;
            } else {
                // Zombie hasn't moved much - check timeout
                let timeSinceLastAction = currentTime - zombieLastDamageTime[zombieId];
                
                if (timeSinceLastAction >= ZOMBIE_STUCK_TIMEOUT) {
                    console.log("Zombie ", zombieId, " stuck for ", timeSinceLastAction, "s - respawning");
                    
                    // Kill stuck zombie
                    mod.Kill(player);
                    
                    // Clean up tracking
                    delete zombieLastPosition[zombieId];
                    delete zombieLastDamageTime[zombieId];
                    delete zombieLastTargetUpdate[zombieId];
                    delete zombieSlapCooldowns[zombieId];
                    delete zombieSlapWindups[zombieId];
                    delete zombieLeapCooldowns[zombieId]; // <-- ADD THIS LINE
                    delete zombieBoostCooldowns[zombieId]; // <-- ADD THIS LINE
                    delete zombieLeapWindups[zombieId]; // <-- ADD THIS LINE
                    delete zombieStunTimers[zombieId]; // <-- ADD THIS
                    delete zombiePreviousHealth[zombieId]; // <-- ADD THIS

    // ============================================
    // 1. ZOMBIE SPECIALIST CLEANUP
    // ============================================

    // --- SMOKER PULL CLEANUP ---
    // If the undeploying player is the active Smoker Puller.
    if (smokerPullActive && isAI && playerID === smokerPullerId) {
        console.log(`Smoker Puller (ID: ${playerID}) stuck. Terminating pull.`);
        // This function resets the global flags (smokerPullActive, pulledPlayerId, smokerPullerId)
        endSmokerPull(); 
    }

    // --- HUNTER POUNCE CLEANUP ---
    // This assumes your Hunter logic tracks the active pouncers in a map named 'hunterPounceStates', 
    // where the key is the Hunter's ID.
    if (isAI && hunterPounceStates[playerID]) {
        console.log(`Hunter Pouncer (ID: ${playerID}) stuck. Terminating pounce.`);
        
        endHunterPounce();
        
        // Remove this specific Hunter's active state from the map
        delete hunterPounceStates[playerID]; 
        
        // OPTIONAL: If the Hunter was the LAST active pouncer, you should reset the global flag:
        // if (Object.keys(hunterPounceStates).length === 0) {
        //     isHunterPounceActive = false;
        // }
    }
                    
                    let zombie = Zombie.get(player);
                    if (zombie) {

                        // --- NEW CLEANUP LOGIC ---
                        if (zombie.isSmokerZombie) {
                            smokersAlive--;
                            specialsAlive--; // <--- NEW DECREMENT
                            smokerZombieIds.delete(zombie.playerId);
                            // General custom zombie cleanup
                            Zombie.remove(zombie.playerId);
                            startSmokerRespawnCooldown(); // Start the cooldown
                            console.log(`Cleaned up stuck Smoker ID ${zombie.playerId}.`);
                        }
                        if (zombie.isHunterZombie) {
                            huntersAlive--;
                            specialsAlive--; // <--- NEW DECREMENT
                            hunterZombieIds.delete(zombie.playerId);
                            // General custom zombie cleanup
                            Zombie.remove(zombie.playerId);
                            delete hunterPounceStates[zombie.playerId];
                            console.log(`Cleaned up stuck Hunter ID ${zombie.playerId}.`);
                        }
                        // --- END NEW CLEANUP ---

                        Zombie.remove(zombieId);
                    }
                    
                    aliveZombieCount--;
                    
                    // Respawn immediately without subtracting from remaining
                    if (roundActive && !gameOver && !maxAmmoEventActive) {
                        let randomPlayer = getRandomAlivePlayer();
                        let spawnerId: number;
                        
                        if (randomPlayer) {
                            let selectedSpawner = findClosestSpawnerToPlayer(randomPlayer);
                            if (selectedSpawner !== undefined) {
                                spawnerId = 100 + selectedSpawner;
                            } else {
                                let activeSpawners = Array.from(activeSpawnerIds);
                                let randomIndex = Math.floor(Math.random() * activeSpawners.length);
                                spawnerId = 100 + activeSpawners[randomIndex];
                            }
                        } else {
                            let activeSpawners = Array.from(activeSpawnerIds);
                            let randomIndex = Math.floor(Math.random() * activeSpawners.length);
                            spawnerId = 100 + activeSpawners[randomIndex];
                        }
                        
                        let spawner = mod.GetSpawner(spawnerId);
                        //mod.SpawnAIFromAISpawner(spawner, mod.SoldierClass.Assault, mod.GetTeam(1));
                        aliveZombieCount++;
                        
                        console.log("Respawned stuck zombie from spawner ", spawnerId);
                    }
                }
            }
        }



        // Get the zombie object to check its type
    let zombie = Zombie.get(player);
    if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) continue;
    if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsAlive)) continue;
    if (!zombie) continue; // Should not happen for an AI player

// ===================================
// --- NEW STUN CHECK (HIGHEST PRIORITY) ---
// ===================================
const stunEndTime = zombieStunTimers[zombieId];
if (stunEndTime) {
    if (currentTime < stunEndTime) {
        // Still stunned, skip all other AI
        continue; // <-- If this is hit, the zombie will be idle/stunned.
    } else {
        // Stun is over
        delete zombieStunTimers[zombieId];
        mod.AISetStance(player, mod.Stance.Stand); // <-- ADD THIS: Force the zombie to stand up
    }
}
// --- END STUN CHECK ---

    // ===================================
    // --- 1. ZOMBIE LEAP EXECUTION CHECK ---
    // ===================================
    const pendingLeap = zombieLeapWindups[zombieId];
    if (pendingLeap) {
        if (currentTime >= pendingLeap.executeTime) {
            
            console.log(`[LEAP EXECUTE] Zombie ${zombieId} executing move to stored position.`);
            
            // Execute the move to the STORED target position
            mod.SetObjectTransformOverTime(
                player,
                mod.CreateTransform(pendingLeap.targetPos, mod.GetObjectRotation(player)),
                pendingLeap.duration, // Use the stored duration
                false, 
                false
            );
            
            // Cleanup the windup state
            delete zombieLeapWindups[zombieId];
            
            // Skip all other AI logic for this tick
            continue; 
        } else {
            // If winding up, skip all other AI logic (can't move while charging)
            //continue;
        }
    }
    // -----------------------------------

    // ===================================
    // --- ZOMBIE LEAP & BOOST WINDUP CHECK ---
    // ===================================
    if (!zombie.isSmokerZombie && !zombie.isHunterZombie) {
        
        if (!zombieSlapWindups[zombieId]) {
            
            let nearestPlayerForLeap = findNearestPlayer(zombiePos);
            if (nearestPlayerForLeap) {
                let playerPos = mod.GetSoldierState(nearestPlayerForLeap, mod.SoldierStateVector.GetPosition);
                
                const yDifference = mod.YComponentOf(playerPos) - mod.YComponentOf(zombiePos);
                const xzDistance = CustomVectorDistance2D(zombiePos, playerPos);

                const tier = getLeapTierForHeight(yDifference);

                // Check Trigger Conditions
                if (tier !== null && xzDistance <= tier.horizontalLimit) {
                    
                    const lastLeapTime = zombieLeapCooldowns[zombieId] || 0;
                    const isLeapOnCooldown = (currentTime < lastLeapTime + ZOMBIE_LEAP_COOLDOWN);
                    
                    let moveDuration = 0;
                    let windupTime = 0;
                    let isBoosting = false;

                    // A. LEAP IS READY (Cooldown is over)
                    if (!isLeapOnCooldown) {
                        console.log(`[LEAP WINDUP] Zombie ${zombieId} starting leap windup.`);
                        moveDuration = tier.duration;
                        windupTime = tier.windupDelay; // <-- Tier-based windup delay
                        zombieLeapCooldowns[zombieId] = currentTime; 
                    }
                    // B. LEAP IS ON COOLDOWN (Try to "Fast Climb" / Boost)
                    else {
                        const lastBoostTime = zombieBoostCooldowns[zombieId] || 0;
                        const isBoostOnCooldown = (currentTime < lastBoostTime + ZOMBIE_BOOST_COOLDOWN);

                        if (!isBoostOnCooldown) {
                            console.log(`[BOOST WINDUP] Zombie ${zombieId} starting boost windup.`);
                            
                            // Use a slower, "climb" duration (1.5x the base)
                            //moveDuration = tier.duration * 1.5 + 0.5;
                            // *** CHANGE IS HERE: USE TIER PROPERTY ***
                            moveDuration = tier.boostDuration; // <-- Use the value from the tier
                            windupTime = 0.1; // Minimal windup for boost
                            isBoosting = true;
                            
                            zombieBoostCooldowns[zombieId] = currentTime;
                        }
                    }

                    // --- STORE THE WINDUP STATE ---
                    if (moveDuration > 0) {
                        zombieLeapWindups[zombieId] = {
                            // Store the player's position at this exact moment
                            targetPos: playerPos, 
                            executeTime: currentTime + windupTime,
                            duration: moveDuration,
                            isBoost: isBoosting,
                        };
                        
                        // Skip all other AI logic for this tick
                        //continue; 
                    }
                }
            }
        }
    }
    // -----------------------------------
    
    // --- Determine the Close-Range Threshold ---
    let currentCloseRange = ZOMBIE_CLOSE_RANGE;
    if (zombie.isSmokerZombie) {
        currentCloseRange = SMOKER_CLOSE_RANGE;
    } else if (zombie.isHunterZombie) {
        currentCloseRange = HUNTER_CLOSE_RANGE;
    }
    // -------------------------------------------

    let lastUpdate = zombieLastTargetUpdate[zombieId] || 0;
    
    // --- Pre-Check: Find Nearest Player & Distance ---
    let nearestPlayer = findNearestPlayer(zombiePos);
    let distanceToPlayer = 999999;
    let isCloseCombat = false; // New flag for close-range priority

    if (nearestPlayer) {
        let playerPos = mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetPosition);
        distanceToPlayer = mod.DistanceBetween(zombiePos, playerPos);
        
        // 1. Check for Close-Range Combat: If too close, switch to standard bot AI.
        if (distanceToPlayer <= currentCloseRange) { // <--- USE DYNAMIC VALUE
            isCloseCombat = true;
            
        }
    }
    
    // -----------------------------------------------------
    // 1. CLOSE-RANGE COMBAT PRIORITY (Force Battlefield Mode)
    // -----------------------------------------------------
    // If a player is close, the zombie acts like a normal bot and skips the manual target lock system.
    if (isCloseCombat) {
        mod.AISetTarget(player); // Ensure any specific lock is cleared
        mod.AIBattlefieldBehavior(player); // Use built-in bot AI for dynamic movement
        
        // We can optionally update the last update time here to prevent an immediate re-entry 
        // into the tracking system if a short interval is set.
        //zombieLastTargetUpdate[zombieId] = currentTime; 
        
        continue; // Skip all further update logic
    }
    
    // -----------------------------------------------------
    // 2. PERFORMANCE FALLBACK (Use Battlefield Mode during Long Delays)
    // -----------------------------------------------------
    // This runs only if we are NOT in close combat.
    // === NEW LOGIC TO PREVENT FREEZING WITH LONG INTERVALS ===
        if (ZOMBIE_TARGET_UPDATE_INTERVAL > 0.9) { //1.6
            let timeUntilNextUpdate = (lastUpdate + ZOMBIE_TARGET_UPDATE_INTERVAL) - currentTime;
            
            // If we have more than 0.5s remaining until the next scheduled update, 
            // clear the target to force the AI to keep moving on its own.
            if (timeUntilNextUpdate > 0.25) { //0.5
                // Clear the target to prevent the AI from freezing
                mod.AISetTarget(player);
                
                // Give it a generic move command (e.g., to the last player position or just forward)
                // For simplicity and general movement, let's aim for a random alive player.
                let nearestPlayer = findNearestPlayer(zombiePos);
                if (nearestPlayer) {
                    let playerPos = mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetPosition);
                    mod.AIMoveToBehavior(player, playerPos);
                } else {
                    // Just move forward if no player is found (shouldn't happen)
                    mod.AIMoveToBehavior(player, zombiePos);
                }
                
                // CRITICAL: Skip the scheduled target update check below
                // The target will be correctly set/reset on the next scheduled update (when the 'else' is hit)
                continue; 
            }
        }
    
    // -----------------------------------------------------
    // 3. STANDARD PERIODIC UPDATE (Time is up - Acquire Target)
    // -----------------------------------------------------
    // This runs only when the update time has been reached.
    if (currentTime - lastUpdate >= ZOMBIE_TARGET_UPDATE_INTERVAL) {
        
        if (nearestPlayer) {
            let playerPos = mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetPosition);
            
            // Set the specific target/movement command, overriding any BattlefieldBehavior
            mod.AIMoveToBehavior(player, playerPos); 
            mod.AISetTarget(player, nearestPlayer); 
        }
        
        zombieLastTargetUpdate[zombieId] = currentTime;
    }
}


// ============================================
// 1. GLOBAL AMMO BONUS FOR EMPTY RELOAD (Primary & Secondary)
// ============================================

for (const idStr in ZombiePlayer.allPlayers) {
    const playerId = parseInt(idStr);
    const zpInstance = ZombiePlayer.allPlayers[playerId]; 
    const player = zpInstance.player; 

    // --- VALIDITY CHECK: Only run for valid players ---
    if (!mod.IsPlayerValid(player)) {
        continue;
    }

    // Ensure the tracking state exists
    if (!playerReloadTracking[playerId]) {
        playerReloadTracking[playerId] = { 
            isCurrentlyReloading: false, 
            isPerformingEmptyReload: false
        };
    }

    const tracker = playerReloadTracking[playerId];
        const isReloading = mod.GetSoldierState(player, SOLDIER_IS_RELOADING);
        
        // --- RELOAD END DETECTION ---
        if (tracker.isCurrentlyReloading && !isReloading) {
            
            for (const slot of RELOAD_SLOTS) {
                
                const currentMagAmmo = mod.GetInventoryAmmo(player, slot);
                const baseMagAmmo = mod.GetInventoryAmmo(player, slot);
                
                // Only proceed if the weapon has a magazine
                if (baseMagAmmo === 0) {
                    continue;
                }
                
                // If the magazine was empty before reload:
                if (currentMagAmmo === baseMagAmmo) {
                    
                    const reserveAmmo = mod.GetInventoryMagazineAmmo(player, slot);

                    // CRITICAL CHECK: Ensure the player has reserve ammo to take from
                    if (reserveAmmo > 0) { 
                        
                        // 1. DEDUCT 1 FROM RESERVE AMMO
                        const newReserveAmmo = reserveAmmo - 1;
                        mod.SetInventoryMagazineAmmo(player, slot, newReserveAmmo);

                        // 2. ADD 1 TO MAGAZINE AMMO (The "bullet in the chamber")
                        const newMagAmmo = currentMagAmmo + 1;
                        
                        if (newMagAmmo <= baseMagAmmo + 1) { 
                            mod.SetInventoryAmmo(player, slot, newMagAmmo);
                        }
                        
                    } else {
                        // If reserve ammo is 0, the player cannot get the bonus bullet.
                        // The engine will leave the magazine at 'baseMagAmmo'.
                        // No action needed here.
                    }
                }
            }
        }

        // Update the tracking state for the next tick
        tracker.isCurrentlyReloading = isReloading;
    }

    // ============================================
    // 2. SHOVE STAMINA REGENERATION LOOP
    // ============================================

    // --- SAFE OPTIMIZATION ---
// Only enter the loop if there is at least one player being tracked for shoves.
if (Object.keys(playerShoveStates).length > 0) {

    for (const idStr in playerShoveStates) {
        const playerId = parseInt(idStr);
        const state = playerShoveStates[playerId];
        
        // --- NEW: Get player and their stats ---
    const player = ZombiePlayer.allPlayers[playerId]?.player;
    if (!player) continue; // Player left or is invalid
    
    // --- LIVE CLASS STATS RETRIEVAL (The proven working method) ---
        let maxStamina: number;
        let regenDelay: number;
        
        if (mod.IsSoldierClass(player, mod.SoldierClass.Engineer)) {
            maxStamina = ENGINEER_SHOVE_STATS.maxStamina;
            regenDelay = ENGINEER_SHOVE_STATS.regenDelay;
        } else if (mod.IsSoldierClass(player, mod.SoldierClass.Assault)) {
            maxStamina = ASSAULT_SHOVE_STATS.maxStamina;
            regenDelay = ASSAULT_SHOVE_STATS.regenDelay;
        } else if (mod.IsSoldierClass(player, mod.SoldierClass.Recon)) {
            maxStamina = RECON_SHOVE_STATS.maxStamina;
            regenDelay = RECON_SHOVE_STATS.regenDelay;
        } else {
            maxStamina = DEFAULT_SHOVE_STATS.maxStamina;
            regenDelay = DEFAULT_SHOVE_STATS.regenDelay;
        }
        // ------------------------------------

        // Minor Optimization: Skip if the player is already at full stamina and not on cooldown
    // Assuming 'stats' is correctly looked up with a live check inside this loop (as previously discussed)
    if (!state.isRestricted && state.currentStamina >= maxStamina) {
        continue; // Skip processing this player if no action is needed
    }

    // Check if player is NOT restricted and NOT at full stamina
    if (!state.isRestricted && state.currentStamina < maxStamina) { // <-- USE STATS
        // Check if regen delay has passed
        if (currentTime > state.lastShoveTime + regenDelay) { // <-- USE STATS
            // Reset stamina to full
            state.currentStamina = maxStamina; // <-- USE STATS
        }
    }
    
    // Check if player IS restricted (on cooldown)
    if (state.isRestricted) {
        // Check if regen delay has passed
        if (currentTime > state.lastShoveTime + regenDelay) { // <-- USE STATS
            // Reset stamina and UNLOCK melee input
            state.currentStamina = maxStamina; // <-- USE STATS
            state.isRestricted = false;
            
            if (mod.IsPlayerValid(player)) {
                mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectMelee, false);
            }
        }
    }
}
}

// ============================================
// 3. SHOVE DETECTION (Phase 1: Detects Damage & Requests Shove)
//    - Reads class-based damage (e.g., 35 or 60) to trigger the shove.
//    - Tracks the swing in shovesRequestedThisTick for single stamina consumption.
// ============================================
for (const zombieIdStr in Zombie.allZombies) {
    const zombieId = parseInt(zombieIdStr);
    const zombie = Zombie.allZombies[zombieId];
    
    if (!zombie || !mod.IsPlayerValid(zombie.player) || !mod.GetSoldierState(zombie.player, mod.SoldierStateBool.IsAlive)) {
        delete zombiePreviousHealth[zombieId]; 
        continue;
    }

    // --- Local Variable Declaration ---
    const zombiePlayer = zombie.player;
    const currentHealth = mod.GetSoldierState(zombiePlayer, mod.SoldierStateNumber.CurrentHealth);
    const previousHealth = zombiePreviousHealth[zombieId] || currentHealth; 
    
    // Calculate damage taken
    const damageTaken = previousHealth - currentHealth;

    // 2. We skip any further processing if no damage occurred.
if (damageTaken <= 0) {
    continue; // Optimization: exit early if no event happened
}

    // --- Dynamic Attacker Identification and Check ---
    // 1. Find the player who caused the damage
    const nearestPlayer = findNearestHumanPlayer(mod.GetSoldierState(zombiePlayer, mod.SoldierStateVector.GetPosition));
    
    // Ensure we found a valid, alive human player
    if (nearestPlayer && mod.GetSoldierState(nearestPlayer, mod.SoldierStateNumber.CurrentHealth) > 0) {
        const playerId = mod.GetObjId(nearestPlayer);
        
        // --- NEW: DIRECTLY DETERMINE THE REQUIRED DAMAGE ---
    let requiredDamage: number;
    
    // Check 1: The Engineer's LIVE class state (which we know works!)
    if (mod.IsSoldierClass(nearestPlayer, mod.SoldierClass.Engineer)) {
        // Look up the Engineer's specific damage value (60)
        requiredDamage = ENGINEER_SHOVE_STATS.meleeDamageTrigger; 
    
    // Check 2: The Support's LIVE class state
    //} else if (mod.IsSoldierClass(nearestPlayer, mod.SoldierClass.Support)) {
        // Look up the Support's specific damage value (e.g., 35)
        //requiredDamage = SUPPORT_SHOVE_STATS.meleeDamageTrigger; // Assuming this is defined
    
    // Fallback: Default stats for Assault, Recon, or other classes
    } else {
        requiredDamage = DEFAULT_SHOVE_STATS.meleeDamageTrigger;
    }
    // --- END DIRECT CHECK ---

        // --- ADD THIS DEBUG LOG ---
        if (mod.IsSoldierClass(nearestPlayer, mod.SoldierClass.Engineer)) {
            console.log(`[SHOVE DEBUG] ${mod.SoldierClass} detected. Required Damage Check: ${requiredDamage}. Damage Taken: ${damageTaken}.`);
        }
        // --- END DEBUG LOG ---
        
        // 3. Check for the specific, class-based melee damage amount (with tolerance)
        // This is the trigger: did the damage taken match the player's required melee damage?
        if (damageTaken === requiredDamage) { //if (damageTaken >= requiredDamage && damageTaken < requiredDamage + 5) {
            
            // 4. Request Shove (Only record the first time this player swings this tick)
            if (!shovesRequestedThisTick[playerId]) {
                
                shovesRequestedThisTick[playerId] = {
                    playerPos: mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetPosition),
                    playerFacing: mod.GetSoldierState(nearestPlayer, mod.SoldierStateVector.GetFacingDirection)
                };
                // Console log to confirm damage was detected and a shove was requested
                console.log(`[SHOVE REQUESTED] Player ${playerId} (Class Damage: ${requiredDamage}) triggered a shove.`);
            }
        }
    }
}

// ============================================
// 4. SHOVE EXECUTION (AOE and Single Stamina Consumption)
// ============================================

// SAFE OPTIMIZATION: Check if the map is empty. If it is, the code simply skips 
// the block below and continues to the next section (Zombie AI).
if (Object.keys(shovesRequestedThisTick).length > 0) {

for (const idStr in shovesRequestedThisTick) {
    const playerId = parseInt(idStr);
    const requestData = shovesRequestedThisTick[playerId];
    
    // Get player object and state
    const player = ZombiePlayer.allPlayers[playerId]?.player;
    const playerState = playerShoveStates[playerId];

    // NEW DEBUG CHECK: Ensure player and state are valid before continuing
    if (!player || !playerState) {
        console.log(`[SHOULD EXECUTE FAILED] Player ${playerId} is not found in allPlayers or playerState is missing.`);
        continue;
    }
    // END NEW DEBUG CHECK

    // --- LIVE CLASS STATS RETRIEVAL (The proven working method) ---
        let stunDuration: number;
        let knockdownChance: number;
        let knockdownStunMultiplier: number;
        let pushbackDistance: number;
        let pushbackDuration: number;

        
        if (mod.IsSoldierClass(player, mod.SoldierClass.Engineer)) {
            stunDuration = ENGINEER_SHOVE_STATS.stunDuration;
            knockdownChance = ENGINEER_SHOVE_STATS.knockdownChance;
            knockdownStunMultiplier = ENGINEER_SHOVE_STATS.knockdownStunMultiplier;
            pushbackDistance = ENGINEER_SHOVE_STATS.pushbackDistance;
            pushbackDuration = ENGINEER_SHOVE_STATS.pushbackDuration;
        } else if (mod.IsSoldierClass(player, mod.SoldierClass.Assault)) {
            stunDuration = ASSAULT_SHOVE_STATS.stunDuration;
            knockdownChance = ASSAULT_SHOVE_STATS.knockdownChance;
            knockdownStunMultiplier = ASSAULT_SHOVE_STATS.knockdownStunMultiplier;
            pushbackDistance = ASSAULT_SHOVE_STATS.pushbackDistance;
            pushbackDuration = ASSAULT_SHOVE_STATS.pushbackDuration;
        } else if (mod.IsSoldierClass(player, mod.SoldierClass.Recon)) {
            stunDuration = RECON_SHOVE_STATS.stunDuration;
            knockdownChance = RECON_SHOVE_STATS.knockdownChance;
            knockdownStunMultiplier = RECON_SHOVE_STATS.knockdownStunMultiplier;
            pushbackDistance = RECON_SHOVE_STATS.pushbackDistance;
            pushbackDuration = RECON_SHOVE_STATS.pushbackDuration;
        } else {
            stunDuration = DEFAULT_SHOVE_STATS.stunDuration;
            knockdownChance = DEFAULT_SHOVE_STATS.knockdownChance;
            knockdownStunMultiplier = DEFAULT_SHOVE_STATS.knockdownStunMultiplier;
            pushbackDistance = DEFAULT_SHOVE_STATS.pushbackDistance;
            pushbackDuration = DEFAULT_SHOVE_STATS.pushbackDuration;
        }
        // ------------------------------------

    // 1. Check if the player is restricted (on cooldown)
    if (playerState.isRestricted) {
        console.log(`[SHOULD EXECUTE FAILED] Player ${playerId} is restricted. Skipping.`);
        continue; 
    }

    // --- EXECUTION BEGINS HERE ---
    console.log(`[SHOULD EXECUTE] Player ${playerId} is initiating AOE shove.`); // <-- ADD THIS LOG

    // 2. Consume Stamina (DO THIS ONLY ONCE PER MELEE SWING)
    playerState.currentStamina--;
    playerState.lastShoveTime = currentTime;
    
    // Set restriction if stamina hits zero
    if (playerState.currentStamina <= 0) {
        playerState.isRestricted = true;
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectMelee, true);
    }
    
    // --- 3. AOE Shove Application (Loop over ALL zombies for the effect) ---
    for (const zombieIdStr in Zombie.allZombies) {
        const zombieId = parseInt(zombieIdStr);
        const zombie = Zombie.allZombies[zombieId];
        
        if (!zombie || !mod.IsPlayerValid(zombie.player) || !mod.GetSoldierState(zombie.player, mod.SoldierStateBool.IsAlive)) {
            continue;
        }

        const zombiePlayer = zombie.player;
        const zombiePos = mod.GetSoldierState(zombiePlayer, mod.SoldierStateVector.GetPosition);
        
        const vectorToZombie = CustomVectorSubtract(zombiePos, requestData.playerPos);

        // A. Radius Check (using player position from the moment of the swing)
        const distSq = CustomVectorLengthSq(vectorToZombie);
        if (distSq > SHOVE_RADIUS_SQ) { //WAS <=
            continue; 
        }

        // B. Facing Check (Dot Product)
        const dirToZombie = CustomVectorNormalize(vectorToZombie);
        const dotProduct = (mod.XComponentOf(requestData.playerFacing) * mod.XComponentOf(dirToZombie)) +
                            (mod.YComponentOf(requestData.playerFacing) * mod.YComponentOf(dirToZombie)) +
                            (mod.ZComponentOf(requestData.playerFacing) * mod.ZComponentOf(dirToZombie));

        if (dotProduct >= SHOVE_FACING_DOT_PRODUCT) { // Use your working comparison <= // if (dotProduct >= SHOVE_FACING_DOT_PRODUCT) { // if (Math.abs(dotProduct) >= Math.abs(SHOVE_FACING_DOT_PRODUCT)) {
            
            // --- EXECUTE SHOVE on THIS Zombie ---
            console.log(`Damage-based Shove: Player ${playerId} shoved Zombie ${zombieId}`); 

            // Check if the zombie is a SPECIAL INFECTED (Smoker, Hunter, etc.)
            // Assuming your Zombie class has a property to identify special types.
            // If you only have common infected, you can skip this check.
            const isCommonInfected = (!zombie.isSmokerZombie && !zombie.isHunterZombie); // Adjust property name as needed if (!zombie.isSmokerZombie && !zombie.isHunterZombie) {
            const chance = Math.random();

            let finalStunDuration = stunDuration;
            let finalStance = mod.Stance.Crouch; // Default to CROUCH STUN

            // 1. Check for Knockdown (Only for common zombies)
            if (isCommonInfected && chance < knockdownChance) {
                // Knockdown success!
                finalStunDuration *= knockdownStunMultiplier; // Double the stun time
                finalStance = mod.Stance.Prone; // Set stance to prone (knocked down)
                console.log(`[KNOCKDOWN SUCCESS] Zombie ${zombieId} knocked down for ${finalStunDuration}s.`);
            }

            // 2. Apply Stance and Stun Timer
            mod.AISetStance(zombiePlayer, finalStance); // Apply the stance (Crouch or Prone)
            mod.AIIdleBehavior(zombiePlayer); // Set to idle (stops movement/attacks)
            zombieStunTimers[zombieId] = currentTime + finalStunDuration; // Set stun timer

            // b) Pushback 
            const pushbackDest = mod.CreateVector(
                mod.XComponentOf(zombiePos) + mod.XComponentOf(dirToZombie) * pushbackDistance,
                mod.YComponentOf(zombiePos),
                mod.ZComponentOf(zombiePos) + mod.ZComponentOf(dirToZombie) * pushbackDistance
            );
            
            mod.SetObjectTransformOverTime(
                zombiePlayer,
                mod.CreateTransform(pushbackDest, mod.GetObjectRotation(zombiePlayer)),
                pushbackDuration,
                false,
                false
            );
        }
    }
}
}

// ============================================
// 3. SUPPORT HP REGENERATION AURA SYSTEM (Complex Dual Logic)
// ============================================
processSupportRegen(currentTime);

// ============================================
// 5. ZOMBIE SLAP, LEAP, AND STUCK DETECTION
// ============================================
for (const idStr in Zombie.allZombies) {
    const zombieId = parseInt(idStr);
    const zObj = Zombie.allZombies[idStr];
    // Retrieve the player object
    const zombiePlayer = zObj?.player; 
    
    // ==========================================================
    // --- CRITICAL CRASH FIX & GLOBAL CLEANUP --- (Top of Loop)
    // ==========================================================
    // If the zombie object doesn't exist or is no longer a valid player object,
    // this is the source of the non-local crash.
    if (!zombiePlayer || !mod.IsPlayerValid(zombiePlayer)) {
        
        // 1. Permanent Cleanup of Global State:
        // Remove the invalid zombie from ALL global trackers that use its ID.
        delete Zombie.allZombies[idStr];
        delete zombieStunTimers[zombieId];
        delete zombieLastDamageTime[zombieId]; 
        delete zombieSlapWindups[zombieId];
        delete zombieLeapCooldowns[zombieId];
        delete zombieLeapWindups[zombieId];
        delete zombieLastTargetUpdate[zombieId];
        delete zombieLastPosition[zombieId];
        delete zombiePreviousHealth[zombieId];
        delete zombieBoostCooldowns[zombieId];
        delete zombieSlapCooldowns[zombieId];
        delete hunterPounceStates[zombieId];
        
        // --- NEW CRITICAL HUNTER/SMOKER/MAX AMMO CLEANUP ---
        smokerZombieIds.delete(zombieId);
        hunterZombieIds.delete(zombieId);
        Zombie.remove(zombieId);
        //maxAmmoZombieIds.delete(zombieId);
        
        continue; // Skip all processing for this invalid/dead zombie
    }
}

    // ============================================
    // A. SUPPORT CLASS AMMO BONUS LOGIC
    // ============================================
    for (const idStr in supportStates) {
        const id = parseInt(idStr);
        const player = ZombiePlayer.allPlayers[id].player;
        const state = supportStates[id];

        // Ensure player is valid and is the correct class
        if (!mod.IsPlayerValid(player) || !mod.IsSoldierClass(player, SUPPORT_CLASS)) {
            // Player changed class or is invalid, delete state
            delete supportStates[id];
            continue;
        }

        const baseMagAmmo = state.maxMagAmmo; 
        const isReloading = mod.GetSoldierState(player, SOLDIER_IS_RELOADING);
        const currentMagAmmo = mod.GetInventoryAmmo(player, SECONDARY_WEAPON_SLOT);

        // 1. Reload Detection: Reset the bonus rounds
        if (isReloading) {
            const maxBonus = Math.floor(baseMagAmmo * 0.5);
            if (state.extraRounds !== maxBonus) {
                state.extraRounds = maxBonus;
            }
        }
        
       // --- 2. Firing Detection (Inferred Shot) ---
        const isSecondaryActive = mod.IsInventorySlotActive(player, SECONDARY_WEAPON_SLOT);
        
        // A shot is inferred if:
        // 1. The secondary weapon is currently equipped.
        // 2. The current ammo count is less than the count from the last tick.
        const shotDetected = isSecondaryActive && (currentMagAmmo < state.ammoCountLastTick);

        if (shotDetected && state.extraRounds > 0 && (currentTime - state.lastFiredBonusTime) > FIRE_DECREMENT_DELAY) {
            
            // 1. Decrement the bonus counter
            state.extraRounds--;
            
            // 2. Add 1 round to the magazine (reversing the shot's ammo consumption)
            const newMagAmmo = currentMagAmmo + 1;
            
            // Apply the new ammo count, ensuring it doesn't exceed the base capacity
            if (newMagAmmo <= baseMagAmmo) {
                mod.SetInventoryAmmo(player, SECONDARY_WEAPON_SLOT, newMagAmmo);
            }
            
            state.lastFiredBonusTime = currentTime;
        }

        // --- CRITICAL STEP: Update ammoCountLastTick for the next iteration ---
        state.ammoCountLastTick = currentMagAmmo;
    }
    
    // ============================================
    // --- NEW: ENGINEER OVERHEAT AND AMMO LOOP --- PUT IT HERE
    // ============================================

    // Iterate only over players we know are (or were) Engineers
for (const idStr in engineerStates) {
    const id = parseInt(idStr);
    const state = engineerStates[id];
    
    // FIX: Use the robust ZombiePlayer map to retrieve the player instance.
    const zombiePlayerInstance = ZombiePlayer.allPlayers[id]; 
    
    // If the player wrapper is missing (e.g., undeployed/left game), clean up the state.
    if (!zombiePlayerInstance) {
        delete engineerStates[id]; 
        continue;
    }
    
    const player = zombiePlayerInstance.player;

    if (!mod.IsPlayerValid(player)) {
        delete engineerStates[id]; // Clean up if the raw player object is invalid
        continue;
    }
    
    // Safety check for class switching (if they switched off Engineer)
    if (!mod.IsSoldierClass(player, mod.SoldierClass.Engineer)) {
        console.log(`Player ${id} is no longer Engineer. Removing state.`);
        delete engineerStates[id];
        continue;
    }

        const isFiring = mod.GetSoldierState(player, mod.SoldierStateBool.IsFiring);
        const currentMagAmmo = mod.GetInventoryAmmo(player, SECONDARY_WEAPON_SLOT);
        
        // --- 1. OVERHEAT LOCKOUT MANAGEMENT (State 3) ---
        if (state.isOverheated) {
            
            // Check if the 5-second lockout is over
            if (currentTime >= state.lockoutEndTime) {
                state.isOverheated = false;
                state.overheatTimer = ENGINEER_MAX_OVERHEAT; // Reset timer
            } else {
                // Still locked out: skip ammo replenish and timer management.
                continue; 
            }
        }
        
        // --- 2. AMMO REPLENISHMENT (When not overheated) ---
        if (currentTime >= state.lastReplenishTime + AMMO_REPLENISH_INTERVAL) {
            
            const replenishAmount = Math.ceil(state.maxMagAmmo * AMMO_REPLENISH_PERCENT);
            const newAmmo = Math.min(currentMagAmmo + replenishAmount, state.maxMagAmmo);
            
            // Replenish magazine ammo
            mod.SetInventoryAmmo(player, SECONDARY_WEAPON_SLOT, newAmmo);
            state.lastReplenishTime = currentTime;
        }

        // --- 3. OVERHEAT TIMER MANAGEMENT ---
        if (isFiring) {
            // State 1: Firing - Timer runs down
            const timeElapsed = currentTime - state.lastFiredTime;
            state.overheatTimer -= timeElapsed; 
            
            state.lastFiredTime = currentTime; // Update last fired time
            
            if (state.overheatTimer <= 0) {
                // Overheated!
                state.isOverheated = true;
                state.overheatTimer = 0;
                state.lockoutEndTime = currentTime + OVERHEAT_LOCKOUT_TIME;
                
                // Immediately set ammo to 0 to "break" the weapon
                mod.SetInventoryAmmo(player, SECONDARY_WEAPON_SLOT, 0); 
                continue;
            }
        } else {
            // Not Firing - Check for Cooling (State 2)
            
            // If the player stopped firing, update lastFiredTime for the 2s delay check
            if (state.lastFiredTime === 0 || state.lastFiredTime < currentTime) {
                 state.lastFiredTime = currentTime;
            }

            // Check if 2 seconds have passed since the last shot
            if (currentTime >= state.lastFiredTime + COOL_DOWN_DELAY) {
                
                // Cooling logic: Increment by 0.5 every 1 second
                if (currentTime >= state.lastIncrementTime + COOL_DOWN_INCREMENT_INTERVAL) {
                    
                    state.overheatTimer = Math.min(state.overheatTimer + COOL_DOWN_INCREMENT_AMOUNT, ENGINEER_MAX_OVERHEAT);
                    state.lastIncrementTime = currentTime; // Reset increment timer
                }
            }
            // If still within the 2-second delay, the timer is stalled (no action needed).
        }
    }
    // ============================================

// ============================================
// 3. ENGINEER UI DRAWING
// ============================================

for (const idStr in engineerStates) {
    const id = parseInt(idStr);
    const zpInstance = ZombiePlayer.allPlayers[id];
    const engineerState = engineerStates[id];

    // Safety checks
    if (!zpInstance || !zpInstance.player || !mod.IsPlayerValid(zpInstance.player)) {
         continue;
    }

    // Check if the player is still the Engineer
    if (mod.IsSoldierClass(zpInstance.player, mod.SoldierClass.Engineer)) {
        
        // If the widget is missing (e.g., player respawned), create it
        if (!zpInstance.engineerContainerId) {
            createEngineerUI(zpInstance.player);
        }
        
        // Call the new global update function
        updateEngineerUI(zpInstance, engineerState); 

    } else {
        // Player changed class, destroy the UI
        destroyEngineerUI(zpInstance);
        delete engineerStates[id];
    }
}
// ============================================

// --------------------------------------------
// 4. POST-TICK HEALTH UPDATE (The loop that MUST be last)
// --------------------------------------------
for (const zombieIdStr in Zombie.allZombies) {
    const zombieId = parseInt(zombieIdStr);
    const zombie = Zombie.allZombies[zombieId];
    
    // CRITICAL: This is the absolute last action: record current health.
    if (!zombie || !mod.IsPlayerValid(zombie.player) || !mod.GetSoldierState(zombie.player, mod.SoldierStateBool.IsAlive)) {
        continue;
    }
    zombiePreviousHealth[zombieId] = mod.GetSoldierState(zombie.player, mod.SoldierStateNumber.CurrentHealth);
}

    // START NEW SLAP WINDUPS
    // ============================================
    for (let i = 0; i < playerCount; i++) {
        let zombie = mod.ValueInArray(allPlayers, i) as mod.Player;
        
        if (!mod.GetSoldierState(zombie, mod.SoldierStateBool.IsAISoldier)) continue;
        if (!mod.GetSoldierState(zombie, mod.SoldierStateBool.IsAlive)) continue;
        
        let zombieId = mod.GetObjId(zombie);
        let zombiePos = mod.GetSoldierState(zombie, mod.SoldierStateVector.GetPosition);
        
        // Skip if already in windup
        if (zombieSlapWindups[zombieId]) continue;
        
        // CRITICAL: Check cooldown PROPERLY
        let lastSlapTime = zombieSlapCooldowns[zombieId] || 0;
        let timeSinceLastSlap = currentTime - lastSlapTime;
        
        if (timeSinceLastSlap < ZOMBIE_SLAP_COOLDOWN) {
            // Still on cooldown - skip this zombie
            continue;
        }
        
        // Find NEAREST HUMAN player in range
        let nearestHuman: mod.Player | undefined;
        let nearestDistance = 999999;
        
        for (let j = 0; j < playerCount; j++) {
            let human = mod.ValueInArray(allPlayers, j) as mod.Player;
            
            if (mod.GetSoldierState(human, mod.SoldierStateBool.IsAISoldier)) continue;
            if (!mod.GetSoldierState(human, mod.SoldierStateBool.IsAlive)) continue;
            
            let humanPos = mod.GetSoldierState(human, mod.SoldierStateVector.GetPosition);
            let distance = mod.DistanceBetween(zombiePos, humanPos);
            
            if (distance < nearestDistance && distance <= ZOMBIE_SLAP_RANGE) {
                nearestDistance = distance;
                nearestHuman = human;
            }
        }
        
        // Start windup on nearest human in range
        if (nearestHuman) {
            console.log("Zombie ", zombieId, " STARTING WINDUP on player ", mod.GetObjId(nearestHuman), " (", timeSinceLastSlap.toFixed(2), "s since last slap)");
            
            zombieSlapWindups[zombieId] = {
                targetPlayerId: mod.GetObjId(nearestHuman),
                windupStartTime: currentTime,
                hasWarned: false
            };
            
            //mod.AIIdleBehavior(zombie);
            mod.AISetTarget(zombie, nearestHuman);
        }
    }
    
    // Update our tracked count with actual count
    zombiesAlive = aliveZombieCount;
    
    // Check if zombies need to be spawned (0 alive but some remaining) - NOT during max ammo event
    if (zombiesAlive === 0 && zombiesRemaining > 0 && !maxAmmoEventActive) {
        console.log("No zombies alive but ", zombiesRemaining, " remaining - force spawning");
        
        // Spawn up to 5 zombies immediately to catch up
        let zombiesToSpawn = Math.min(zombiesRemaining, 5);
        
        for (let i = 0; i < zombiesToSpawn; i++) {
            let randomPlayer = getRandomAlivePlayer();
            let spawnerId: number;
            
            if (randomPlayer) {
                let selectedSpawner = findClosestSpawnerToPlayer(randomPlayer);
                if (selectedSpawner !== undefined) {
                    spawnerId = 100 + selectedSpawner;
                } else {
                    let activeSpawners = Array.from(activeSpawnerIds);
                    let randomIndex = Math.floor(Math.random() * activeSpawners.length);
                    spawnerId = 100 + activeSpawners[randomIndex];
                }
            } else {
                let activeSpawners = Array.from(activeSpawnerIds);
                let randomIndex = Math.floor(Math.random() * activeSpawners.length);
                spawnerId = 100 + activeSpawners[randomIndex];
            }
            
            let spawner = mod.GetSpawner(spawnerId);
            //mod.SpawnAIFromAISpawner(spawner, mod.SoldierClass.Assault, mod.GetTeam(1));
     }
   }
}
// P18 Easter Egg - Accidental Discharge
export function OngoingPlayer(player: mod.Player) {
if(!gameOver) {
    if (mod.GetSoldierState(player, mod.SoldierStateBool.IsAISoldier)) {
        // This is AI/zombie - force to team 1
        let currentTeam = mod.GetTeam(player);
        let expectedTeam = mod.GetTeam(1);
        
        if (mod.GetObjId(currentTeam) !== mod.GetObjId(expectedTeam)) {
            mod.SetTeam(player, mod.GetTeam(1));
        }
        return;
    }
    // Human player - force to team 2 continuously
    let currentTeam = mod.GetTeam(player);
    let expectedTeam = mod.GetTeam(2);
    
    if (mod.GetObjId(currentTeam) !== mod.GetObjId(expectedTeam)) {
        mod.SetTeam(player, mod.GetTeam(2));
        console.log("Corrected player team to Team 2");
    }
}
}

/**
 * Initiates the Smoker pull sequence: locks inputs, sets camera, 
 * and prepares the system for the OngoingGlobal loop to take over.
 */
function startSmokerPull(pulledPlayer: mod.Player, smoker: mod.Player) {
    // Check 1: Enforce global exclusivity (only one pull at a time)
    if (smokerPullActive) return;

    const smokerId = mod.GetObjId(smoker);

    // --- FINAL SANITY CHECK ---
    // Ensure the player object we received is actually a Smoker based on our custom class data.
    const killerZombie = Zombie.allZombies[smokerId];
    if (!killerZombie || !killerZombie.isSmokerZombie) {
        console.log("FATAL ERROR: Attempted to start pull with a non-Smoker ID.");
        return; 
    }
    // --------------------------

    smokerPullActive = true;
    smokerPullerId = smokerId; // Store the ID
    pulledPlayerId = mod.GetObjId(pulledPlayer);

    console.log(`SMOKER PULL INITIATED: Smoker ${smokerPullerId} pulling Player ${pulledPlayerId}`);

    // --- State Changes (Initial Lock) ---
    mod.EnableAllInputRestrictions(smoker, true);         
    mod.EnableAllInputRestrictions(pulledPlayer, true); //true
    mod.EnableInputRestriction(pulledPlayer, mod.RestrictedInputs.SelectMelee, true);
    mod.EnableInputRestriction(pulledPlayer, mod.RestrictedInputs.SelectThrowable, true);   
    //mod.SetCameraTypeForPlayer(pulledPlayer, mod.Cameras.ThirdPerson);
    (mod as any)?.SetCameraForPlayer?.(pulledPlayer, smoker, mod.Cameras.ThirdPerson); 
    mod.AISetStance(smoker, mod.Stance.Stand);
    mod.SetPlayerMovementSpeedMultiplier(smoker, 0.01) 
    mod.AIEnableShooting(smoker, false);

    // --- NEW: Remove Smoker's Reserve Ammo ---
    //mod.SetInventoryAmmo(smoker, mod.InventorySlots.PrimaryWeapon, 0); //empty clip 
    //mod.SetInventoryMagazineAmmo(smoker, mod.InventorySlots.PrimaryWeapon, 0); // Also ensure the reserve is empty
    mod.AIEnableShooting(smoker, false); // Ensures they stop firing (already done, but good practice)
    // ----------------------------------------- 

    // Add player to the disabled set
    disabledPlayerIds.add(pulledPlayerId);

    // --- Initialize Timer ---
    // Start the first pull immediately (or set the time to 0 to trigger on next tick)
    smokerLastPullTime = mod.GetMatchTimeElapsed(); 
}

/**
 * Terminates the Smoker pull event and cleans up player/smoker states.
 */
function endSmokerPull() {
    // 1. Global Safety Check
    if (!smokerPullActive) return;

    const victimId = pulledPlayerId; // Capture the victim's ID before it's reset

    // --- Cleanup Player State (The Victim) ---
    const player = ZombiePlayer.allPlayers[pulledPlayerId]?.player;

    // Remove player from the disabled set
    disabledPlayerIds.delete(pulledPlayerId);

    if (mod.IsPlayerValid(player)) {
        // A. Remove Locks and Restore Camera
        mod.EnableAllInputRestrictions(player, false); // Unlock inputs
        // 1. Explicitly ENABLE all standard movement/action inputs
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.CameraPitch, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.CameraYaw, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Crouch, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.CycleFire, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.CyclePrimary, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.FireWeapon, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Interact, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Jump, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.MoveForwardBack, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.MoveLeftRight, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Prone, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Reload, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectCharacterGadget, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectMelee, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectOpenGadget, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectPrimary, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectSecondary, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectThrowable, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, false);
        //mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, false);
        //mod.SetCameraTypeForPlayer(player, mod.Cameras.FirstPerson); // Reset camera
        // --- ADD DELAY ---
        //await mod.Wait(0); // Wait for one single game tick
        // --- END DELAY ---
        // 2. Explicitly RESTRICT Zoom (always restricted)
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, true);

        // 3. Conditional Restriction Logic (Based on Class)
        
        // --- PRONE RESTRICTION ---
        // Restrict Prone if the player is an Engineer (true)
        // Allow Prone otherwise (false)
        let restrictProne = mod.IsSoldierClass(player, mod.SoldierClass.Engineer);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Prone, restrictProne);

        // --- SPRINT RESTRICTION ---
        // Allow Sprint if the player is an Assault (false)
        // Restrict Sprint otherwise (true)
        let restrictSprint = !mod.IsSoldierClass(player, mod.SoldierClass.Assault);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, restrictSprint);
        
        // B. Stop any ongoing movement immediately
        // This command cancels the mod.MoveObject pull effect
        const playerPos = mod.GetSoldierState(player, mod.SoldierStateVector.GetPosition);
        mod.StopActiveMovementForObject(player); 
    }

    // --- Cleanup Smoker State (The Killer) ---
    const smoker = Zombie.allZombies[smokerPullerId]?.player;
    if (mod.IsPlayerValid(smoker)) {
        // A. Remove Locks and Restore AI Behavior
        mod.EnableAllInputRestrictions(smoker, false); // Unlock AI inputs
        
        // B. Restore speed and shooting
        // You might need to make AI speed dynamic based on the current round, 
        // but restoring to 'Walk' is a safe default.
        mod.AISetMoveSpeed(smoker, mod.MoveSpeed.Walk);
        mod.SetPlayerMovementSpeedMultiplier(smoker, 1.25);  
        mod.AIEnableShooting(smoker, true); // Allow the Smoker to shoot again
    }

    // --- Reset Global State and Timers ---
    smokerPullActive = false;
    smokerPullerId = 0;
    pulledPlayerId = 0;
    smokerLastPullTime = 0; // Clear the timer for the next pull event
    
    // --- Set the grace period end time and the last victim ---
    smokerPullGracePeriodEndTime = mod.GetMatchTimeElapsed() + SMOKER_GRACE_PERIOD_SECONDS; 
    lastPulledPlayerId = victimId; // Set the ID of the immune player
    
    console.log(`SMOKER PULL TERMINATED. Player ID ${lastPulledPlayerId} immune until: ${smokerPullGracePeriodEndTime.toFixed(2)}s`);
}


/**
 * Calculates a random or fixed cooldown duration based on death reason 
 * and sets the start/end time using the game's clock.
 */
function startSmokerRespawnCooldown() {
    if (isSmokerOnCooldown) return;
         
        //let cooldownDurationSeconds: number;
        const roll = Math.random(); 
        let cooldownDurationSeconds = 12; // Default duration

        if (roll < 0.45) { 
            cooldownDurationSeconds = 30; // 45% chance for 30s
        } else if (roll < 0.75) {
            cooldownDurationSeconds = 21; // 30% chance for 21s
        } else if (roll < 1.00) {
            cooldownDurationSeconds = 17; // 25% chance for 17s
        }
        console.log(`Smoker killed normally. Starting respawn cooldown: ${cooldownDurationSeconds} seconds.`);
    
    isSmokerOnCooldown = true;
    
    // --- Manual Time Tracking Setup ---
    smokerCooldownStartTime = mod.GetMatchTimeElapsed();
    smokerCooldownEndTime = smokerCooldownStartTime + cooldownDurationSeconds;

    console.log(`Cooldown set. Ends at game time: ${smokerCooldownEndTime.toFixed(2)}s.`);
}


/**
 * Starts the Hunter Pounce event (the 'pinned' state).
 */
function startHunterPounce(hunter: mod.Player, victim: mod.Player) {
    const hunterId = mod.GetObjId(hunter);
    const victimId = mod.GetObjId(victim);
    
    console.log(`HUNTER POUNCE CONNECTED: Hunter ${hunterId} pinning Player ${victimId}`);

    // Set global lock
    isHunterPounceActive = true;
    hunterPouncerId = hunterId;
    pouncedPlayerId = victimId;
    
    // Lock both
    mod.EnableAllInputRestrictions(hunter, true);
    mod.EnableAllInputRestrictions(victim, true); //true
    mod.EnableInputRestriction(victim, mod.RestrictedInputs.SelectMelee, true);
    mod.EnableInputRestriction(victim, mod.RestrictedInputs.SelectThrowable, true);
    
    // Hunter stands, player camera doesn't change (as requested)
    //mod.SetCameraTypeForPlayer(victim, mod.Cameras.ThirdPerson); // Reset camera
    (mod as any)?.SetCameraForPlayer?.(victim, hunter, mod.Cameras.ThirdPerson);
    mod.SetPlayerMovementSpeedMultiplier(hunter, 0.07);
    mod.AISetStance(hunter, mod.Stance.Prone);

    // Add player to the disabled set
    disabledPlayerIds.add(victimId); 

    // Set initial damage time
    hunterPounceLastDamageTime = mod.GetMatchTimeElapsed();
}

/**
 * Terminates the Hunter Pounce event and cleans up.
 */
function endHunterPounce() {
    if (!isHunterPounceActive) return;

    console.log(`Hunter pounce terminating (Pouncer: ${hunterPouncerId}, Victim: ${pouncedPlayerId})`);

    // --- Cleanup Player State ---
    const player = ZombiePlayer.allPlayers[pouncedPlayerId]?.player;

    // Remove player from the disabled set
    disabledPlayerIds.delete(pouncedPlayerId);

    if (mod.IsPlayerValid(player)) {
        //mod.EnableAllInputRestrictions(player, false);
        // 1. Explicitly ENABLE all standard movement/action inputs
        mod.EnableInputRestriction(player, mod.RestrictedInputs.CameraPitch, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.CameraYaw, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Crouch, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.CycleFire, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.CyclePrimary, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.FireWeapon, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Interact, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Jump, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.MoveForwardBack, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.MoveLeftRight, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Prone, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Reload, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectCharacterGadget, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectMelee, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectOpenGadget, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectPrimary, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectSecondary, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.SelectThrowable, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, false);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, false);
        mod.SetCameraTypeForPlayer(player, mod.Cameras.FirstPerson); // Reset camera
        // --- ADD DELAY ---
        //await mod.Wait(0); // Wait for one single game tick
        // --- END DELAY ---
        // 2. Explicitly RESTRICT Zoom (always restricted)
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Zoom, true);

        // 3. Conditional Restriction Logic (Based on Class)
        
        // --- PRONE RESTRICTION ---
        // Restrict Prone if the player is an Engineer (true)
        // Allow Prone otherwise (false)
        let restrictProne = mod.IsSoldierClass(player, mod.SoldierClass.Engineer);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Prone, restrictProne);

        // --- SPRINT RESTRICTION ---
        // Allow Sprint if the player is an Assault (false)
        // Restrict Sprint otherwise (true)
        let restrictSprint = !mod.IsSoldierClass(player, mod.SoldierClass.Assault);
        mod.EnableInputRestriction(player, mod.RestrictedInputs.Sprint, restrictSprint);
    }

    // --- Cleanup Hunter State ---
    const hunter = Zombie.allZombies[hunterPouncerId]?.player;
    if (mod.IsPlayerValid(hunter)) {
        mod.EnableAllInputRestrictions(hunter, false);
        // Reset to default Hunter state (fast, crouched)
        mod.AISetMoveSpeed(hunter, mod.MoveSpeed.InvestigateRun);
        mod.AISetStance(hunter, mod.Stance.Stand);
        mod.SetPlayerMovementSpeedMultiplier(hunter, 1.5);
    }
    
    // Remove from state machine
    delete hunterPounceStates[hunterPouncerId];

    // --- Reset Global State ---
    isHunterPounceActive = false;
    hunterPouncerId = 0;
    pouncedPlayerId = 0;
    hunterPounceLastDamageTime = 0;
}

// Helper function to reliably get Max Magazine Capacity.
// Assuming the function that WASN'T the current state is the Max Capacity.
// Since you stated:
// mod.GetInventoryAmmo = Current Mag Ammo
// mod.GetInventoryMagazineAmmo = Reserve Ammo
// We must assume the original GetInventoryAmmo was the intended Max Capacity.
function GetMaxMagazineCapacity(player: mod.Player, slot: mod.InventorySlots): number {
    // NOTE: This must be the function that gives you the stable Max Capacity,
    // which is likely mod.GetInventoryAmmo in its standard context, or a custom stored value.
    // For this global feature to work, we will use the function that provides the highest stable value.
    // We will trust that mod.GetInventoryAmmo provides the MAX capacity when used outside of the current state.
    // **Please confirm the name of the function that returns Max Magazine Capacity and replace this.**
    
    // Using mod.GetWeaponAmmoCapacity is the most robust solution for Max Capacity:
    return mod.GetInventoryAmmo(player, slot); 
}

function processSupportRegen(currentTime: number) { //async?
const activeSupportPlayers: mod.Player[] = [];

// --- A. FIND ALL ACTIVE SUPPORT PLAYERS (Aura Sources) ---
for (const idStr in ZombiePlayer.allPlayers) {
    //const playerId = parseInt(idStr);
    const zPlayer = ZombiePlayer.allPlayers[idStr]; //ZombiePlayer.get(playerId);
    const player = zPlayer.player; //mod.GetPlayerById(playerId);

    // Safety check for players who might be logging off
    if (!mod.IsPlayerValid(player)) {
        continue;
    }
    
    // Check if player is valid, alive, and the designated support class
    if (mod.IsPlayerValid(player) && zPlayer && zPlayer.isAlive && mod.IsSoldierClass(player, SUPPORT_CLASS)) {
        activeSupportPlayers.push(player);
    }
}

// --- B. ITERATE THROUGH ALL POTENTIAL TARGETS ---
for (const idStr in ZombiePlayer.allPlayers) {
    const targetPlayerId = parseInt(idStr);
    const zTargetPlayer = ZombiePlayer.allPlayers[idStr];

    // CRASH PREVENTION STEP 1: Check Custom Object Data and Alive Status
    // This is the fastest check to filter out dead or invalid players
    if (!zTargetPlayer || !zTargetPlayer.isAlive) { 
        delete playerRegenTracking[targetPlayerId]; 
        continue;
    }

    // Safely define the engine object now that zTargetPlayer is known to exist
    const targetPlayer = zTargetPlayer.player;
    
    // 1. Crash/Filter Check: Ensure the target player is valid, alive, and human
    //if (!mod.IsPlayerValid(targetPlayer) || !zTargetPlayer || !zTargetPlayer.isAlive) { 
        //if (!mod.IsPlayerValid(targetPlayer) || !zTargetPlayer.isAlive) {
            //delete playerRegenTracking[targetPlayerId]; // Cleanup
            //continue;
        //}
        // STEP 2: STALE ENGINE OBJECT VALIDATION (CRASH PREVENTION)
    // Checks for: Player object is still valid in the game engine (must be checked after targetPlayer is defined)
    if (!mod.IsPlayerValid(targetPlayer)) {
        delete playerRegenTracking[targetPlayerId]; 
        continue; 
    }

    // --- CRITICAL SAFETY NET: Wrap state fetching in try...catch ---
        let currentHealth = 0;
        let maxHealth = 0;
        
        try {
            currentHealth = mod.GetSoldierState(targetPlayer, mod.SoldierStateNumber.CurrentHealth);
            maxHealth = mod.GetSoldierState(targetPlayer, mod.SoldierStateNumber.MaxHealth);
        } catch (e) {
            // If the player object is freed from memory and reading state crashes, clean up and skip.
            console.log(`Regen system skipped player ${targetPlayerId} due to state reading crash.`);
            delete playerRegenTracking[targetPlayerId]; 
            continue; 
        }
        
        // --- SECONDARY HEALTH VALIDATION (Catches death) ---
        // If health is 0 or less, the player is dead or dying. Skip healing logic.
        if (currentHealth <= 0) {
             delete playerRegenTracking[targetPlayerId]; // Final cleanup on death
             continue;
        }
    
    // Initialize tracking state
    if (!playerRegenTracking[targetPlayerId]) {
        playerRegenTracking[targetPlayerId] = {
            lastHealTime: currentTime, 
            lastDamageTime: 0,
            previousHealth: currentHealth,
            fractionalHealAccumulator: 0, 
        };
    }
    let tracking = playerRegenTracking[targetPlayerId];
    const isTargetSupport = mod.IsSoldierClass(targetPlayer, SUPPORT_CLASS); //zTargetPlayer.isSupportClass;
    
    // ======================================================
    // DAMAGE AND HEALTH CHECK (Must run first for cooldowns)
    // ======================================================
    
    // --- DAMAGE DETECTION (SHARED: Update lastDamageTime) ---
    // This must run before the low health check to correctly detect damage leading to death/low health.
    const damageTaken = tracking.previousHealth - currentHealth;
    if (damageTaken > 0) {
        tracking.lastDamageTime = currentTime;
    }
    tracking.previousHealth = currentHealth; // Update for the next tick's comparison

    // --- LOW HEALTH CATCH (Stops healing systems) ---
    // If the player is dead or critically wounded, skip healing logic.
    if (currentHealth <= 1) {
        continue; 
    }

    
    // ======================================================
    // LOGIC 1: SUPPORT'S PERSONAL SELF-HEAL (36% req, 2 HP/5s, 5s delay)
    // ======================================================
    if (isTargetSupport) {
        const thresholdHP = Math.floor(maxHealth * SUPPORT_SELF_REGEN_THRESHOLD);

        // Check conditions for Self-Heal
        const isBelowThreshold = currentHealth < thresholdHP;
        const isOnHealCooldown = (currentTime - tracking.lastHealTime) < SUPPORT_SELF_HEAL_COOLDOWN;
        const isOnDamageCooldown = (currentTime - tracking.lastDamageTime) < SUPPORT_SELF_DAMAGE_COOLDOWN;
        
        if (isBelowThreshold && !isOnHealCooldown && !isOnDamageCooldown) {
            
            // Calculate the actual heal amount: exactly 2 HP, but capped by max health.
            const healAmount = Math.min(SUPPORT_SELF_REGEN_AMOUNT, maxHealth - currentHealth);
            
            if (healAmount > 0) {
                // FIX: Use mod.Heal (takes delta)
                mod.Heal(targetPlayer, healAmount); 
                tracking.lastHealTime = currentTime; // Reset the 5s cooldown
            }
        }


    // ======================================================
    // LOGIC 2: AURA REGENERATION (No HP req, 0.5 HP/2s, 2s delay + Stacks)
    // ======================================================
    let auraStacks = 0;
    
    // Calculate stacks (excluding the target player themselves)
    for (const supportPlayer of activeSupportPlayers) {
        const supportPlayerId = mod.GetObjId(supportPlayer);
        
        if (targetPlayerId === supportPlayerId) {
            continue; // Exclude self from stacking check
        }
        //const distance = mod.GetDistance(supportPlayer, targetPlayer);
        //if (distance <= SUPPORT_AURA_RANGE) {
        // --- FETCH POSITIONS (Consistent with your AOE pattern) ---
        const sourcePos = mod.GetSoldierState(supportPlayer, mod.SoldierStateVector.GetPosition);
        const targetPos = mod.GetSoldierState(targetPlayer, mod.SoldierStateVector.GetPosition);
        
        // 1. Calculate the vector between the source and the target
        const vectorToTarget = CustomVectorSubtract(sourcePos, targetPos);
        
        // 2. Calculate the squared distance (The high-performance check)
        const distSq = CustomVectorLengthSq(vectorToTarget); 

        // 3. Compare squared distance to squared range
        if (distSq <= SUPPORT_AURA_RANGE_SQ) {
            auraStacks++;
        }
    }

    if (auraStacks > 0) {
        // Check conditions for Aura-Heal
        const isOnHealCooldown = (currentTime - tracking.lastHealTime) < SUPPORT_AURA_HEAL_COOLDOWN;
        const isOnDamageCooldown = (currentTime - tracking.lastDamageTime) < SUPPORT_AURA_DAMAGE_COOLDOWN; // Shorter 2s delay
        
        if (!isOnHealCooldown && !isOnDamageCooldown) {
            
            // Calculate the stacked regeneration amount: Base * (1.3 ^ N supports)
            const stackedMultiplier = Math.pow(SUPPORT_STACK_MULTIPLIER, auraStacks);
            const effectiveHealAmount = SUPPORT_AURA_BASE_REGEN * stackedMultiplier;

            let newHealth = Math.floor(currentHealth + effectiveHealAmount);
            
            // Cap the heal at max health (NO 36% threshold)
            newHealth = (newHealth); //Math.min maxHealth
            
            // Apply the heal
            if (newHealth > currentHealth) {
                mod.Heal(targetPlayer, newHealth);
                tracking.lastHealTime = currentTime; // Reset the heal cooldown
            }
        }
    }
    }
}
}

/**
 * Creates the Engineer Overheat UI using the successful robust binding pattern.
 * This is the final, clean UI implementation.
 */
async function createEngineerUI(player: mod.Player) {
    const playerId = mod.GetObjId(player); 
    const zpInstance = ZombiePlayer.allPlayers[playerId];

    if (!zpInstance || zpInstance.engineerContainerId) {
        return; 
    }
    
    // Use the player's ID for unique widget names
    const containerName = "eng_container_" + playerId;
    const barName = "eng_bar_" + playerId;
    const textName = "eng_text_" + playerId; 

    // Wait 1 tick to let the UI system process the name registration
    await mod.Wait(0); 

    try {
        // 1. CREATE CONTAINER (Position: TopLeft [855, 623.55], Size: [210, 210])
        mod.AddUIContainer(
            containerName,
            mod.CreateVector(855, 623.55, 0), // <--- Correct Position
            mod.CreateVector(210, 210, 0),    // <--- Correct Size
            mod.UIAnchor.TopLeft,
            mod.GetUIRoot(),
            true, // Visible
            0,    // Padding
            mod.CreateVector(0.2, 0.2, 0.2), // <--- Gray Background
            1.0,  // bgAlpha
            mod.UIBgFill.Blur,               // <--- Blur Fill
            playerId // Binding by ID
        );
        const container = mod.FindUIWidgetWithName(containerName);

        if (!container) {
            console.error(`[UI ERROR] Failed to create Container for player ${playerId}`);
            return;
        }

        // 2. CREATE BAR IMAGE (Child, full size of container)
        mod.AddUIImage(
            barName,
            mod.CreateVector(0, 0, 0), 
            mod.CreateVector(210, 210, 0), // Relative to container
            mod.UIAnchor.TopLeft,
            container, // Parent to container
            true, 0,
            mod.CreateVector(0, 0, 0), 0, mod.UIBgFill.None, // Transparent
            mod.UIImageType.None,
            mod.CreateVector(1, 1, 1), 1.0,
            playerId 
        );
        
        // 3. CREATE TEXT LABEL (Child, centered)
        mod.AddUIText(
            textName,
            mod.CreateVector(0, 0, 0),
            mod.CreateVector(150, 150, 0), // Relative size
            mod.UIAnchor.Center,
            container, // Parent to container
            true, 0, 
            mod.CreateVector(0, 0, 0), 0, mod.UIBgFill.None, // Transparent
            mod.Message(""), // Initial text
            38, 
            mod.CreateVector(1, 1, 1), 1.0,
            mod.UIAnchor.Center,
            playerId
        );
        
        // --- 4. RACE CONDITION FIX: Wait one tick for the children to register ---
        await mod.Wait(0); 
        
        // 5. Find and Store the IDs
        zpInstance.engineerContainerId = container;
        zpInstance.engineerBarId = mod.FindUIWidgetWithName(barName);
        zpInstance.engineerTextId = mod.FindUIWidgetWithName(textName);

        if (zpInstance.engineerBarId && zpInstance.engineerTextId) {
            console.log(`[UI DEBUG] Engineer UI fully created and found for ${playerId}.`);
        } else {
            console.error(`[UI DEBUG] FAILED to find child widgets for ${playerId}.`);
        }

    } catch (e) {
        console.error(`[UI CRASH] Error during direct UI creation: ${e}`);
    }
}

/**
 * Updates the Engineer UI's text and color based on the current state.
 * Called from OngoingGlobal.
 */
function updateEngineerUI(zpInstance: ZombiePlayer, state: EngineerState) {
    // Check if the widgets have been successfully created
    if (!zpInstance.engineerTextId || !zpInstance.engineerBarId) {
        return;
    }
    
    let barColorArray = COLOR_RED_ARRAY;
    let statusText = "";
    let barRatio = 0; 

    // --- State Logic ---
    if (state.isOverheated) {
        barColorArray = COLOR_ORANGE_ARRAY; 
        const timeRemaining = state.lockoutEndTime - mod.GetMatchTimeElapsed();
        statusText = `LOCKOUT: ${Math.max(0, timeRemaining).toFixed(1)}s`;
        barRatio = 1.0 - (timeRemaining / OVERHEAT_LOCKOUT_TIME); 

    } else {
        barRatio = Math.min(Math.max(0, state.overheatTimer / ENGINEER_MAX_OVERHEAT), 1.0);
        
        if (state.overheatTimer >= ENGINEER_MAX_OVERHEAT) {
            barColorArray = COLOR_GREEN_ARRAY;
            statusText = "READY";
        } else {
            barColorArray = COLOR_RED_ARRAY;
            statusText = `HEAT: ${state.overheatTimer.toFixed(1)}s`;
        }
    }
    
    // --- UI Updates ---
    const messageText = mod.Message(statusText); 
    mod.SetUITextLabel(zpInstance.engineerTextId, messageText); 
    
    const colorVector = mod.CreateVector(barColorArray[0], barColorArray[1], barColorArray[2]);
    mod.SetUIImageColor(zpInstance.engineerBarId, colorVector);
    
    // NOTE: You still need a function to set the bar's fill/progress
    // e.g., mod.SetUIProgressBar(zpInstance.engineerBarId, barRatio);
}

/**
 * Destroys a player's Engineer UI widgets.
 * Called from OnPlayerDied.
 */
function destroyEngineerUI(zpInstance: ZombiePlayer) {
    // We only need to destroy the main container.
    // The children (bar, text) will be destroyed with it.
    if (zpInstance.engineerContainerId) {
        mod.DeleteUIWidget(zpInstance.engineerContainerId);
    }
    
    // Clear the IDs from the instance
    zpInstance.engineerContainerId = undefined;
    zpInstance.engineerBarId = undefined;
    zpInstance.engineerTextId = undefined;
}

    // Add this new function to your script, ideally near the end or in the main logic section
async function updateTargetIntervalLoop() {
    console.log("Starting Dynamic Target Update Interval Loop...");
    
    // Default interval for when a round isn't active or other conditions apply
    const DEFAULT_CLOSE_RANGE = 5.0;
    const DEFAULT_INTERVAL = 0.6;
    // How often to check the zombie count and update the interval (e.g., every 5 seconds)
    const CHECK_INTERVAL_SECONDS = 3; //3
    
    while (!gameOver) {
        if (roundActive) {
            let currentZombies = zombiesAlive;
            let newInterval: number;
            let newCloseRange: number;

            // Define the dynamic intervals based on zombie count
            if (currentZombies <= 15) {
                newInterval = 0.2; // Highly responsive 0.2
            } else if (currentZombies <= 24) {
                newInterval = 0.4; //0.4
            //} else if (currentZombies <= 45) {
                //newInterval = 0.6;
            } else if (currentZombies <= 50) {
                newInterval = 0.6; //0.6
            } else if (currentZombies <= 53) { 
                newInterval = 0.9; // Default/Medium 0.9
            } else if (currentZombies <= 62) {
                newInterval = 1.75; // Less responsive (performance saving) 1.75
            } else if (currentZombies <= 70) {
                newInterval = 2.25; // Less responsive (performance saving)
            } else if (currentZombies <= 77) {
                newInterval = 3.60; // Less responsive (performance saving)
            } else if (currentZombies <= 84) {
                newInterval = 6.25;
            } else if (currentZombies <= 90) {
                newInterval = 8.60;
            } else if (currentZombies <= 92) {
                newInterval = 15.25;
            } else { // currentZombies > 62
                newInterval = 20.60; // Least responsive (major performance saving)
                
            }

            // --- ZOMBIE_CLOSE_RANGE LOGIC ---
            // A smaller range means the zombie has to be closer to switch to aggressive AI.
            // A larger range gives them more "warning" before switching to bot AI.
            
            if (currentZombies <= 15) {
                newCloseRange = 3.0; // Very close range for low counts (high skill floor) 3.0
            } else if (currentZombies <= 24) {
                newCloseRange = 3.0; // Default range 5.0
            } else if (currentZombies <= 32) {
                newCloseRange = 3.0; // Wider range for moderate crowds 6.5
            } else if (currentZombies <= 35) {
                newCloseRange = 3.0; //7.0
            } else if (currentZombies <= 40) {
                newCloseRange = 3.0; //7.75
            } else if (currentZombies <= 50) {
                newCloseRange = 3.0; //8.5
            } else { // currentZombies > 70
                newCloseRange = 5.0; // Very wide range for large crowds (easier for players to trigger AI) 12.0
            }
            
            // Apply the new interval if it's different
            if (ZOMBIE_TARGET_UPDATE_INTERVAL !== newInterval) {
                // @ts-ignore
                // NOTE: ZOMBIE_TARGET_UPDATE_INTERVAL is defined as a 'const' at the top
                // You must change it to 'let' for this to work.
                ZOMBIE_TARGET_UPDATE_INTERVAL = newInterval;
                console.log(`ZOMBIE_TARGET_UPDATE_INTERVAL updated to ${newInterval}s (Zombies Alive: ${currentZombies})`);
            }

            if (ZOMBIE_CLOSE_RANGE !== newCloseRange) {
                // @ts-ignore (Need to use let instead of const)
                // NOTE: ZOMBIE_CLOSE_RANGE is defined as a 'const' at the top
                // You must change it to 'let' for this to work.
                ZOMBIE_CLOSE_RANGE = newCloseRange;
                console.log(`ZOMBIE_CLOSE_RANGE updated to ${newCloseRange}m (Zombies: ${currentZombies})`);
            }

        } else {
            // Reset to default when the round is not active (e.g., during wave delay)
            if (ZOMBIE_TARGET_UPDATE_INTERVAL !== DEFAULT_INTERVAL) {
                // @ts-ignore
                ZOMBIE_TARGET_UPDATE_INTERVAL = DEFAULT_INTERVAL;
                console.log(`ZOMBIE_TARGET_UPDATE_INTERVAL reset to default ${DEFAULT_INTERVAL}s (Round Inactive)`);
            }
             if (ZOMBIE_CLOSE_RANGE !== DEFAULT_CLOSE_RANGE) {
                // @ts-ignore
                ZOMBIE_CLOSE_RANGE = DEFAULT_CLOSE_RANGE;
                console.log(`ZOMBIE_CLOSE_RANGE reset to default ${DEFAULT_CLOSE_RANGE}m (Round Inactive)`);
            }
        }

        // Wait for the next check
        await mod.Wait(CHECK_INTERVAL_SECONDS);
    }
}

// Helper functions to create UI from a JSON object tree:
//-----------------------------------------------------------------------------------------------//

type UIVector = mod.Vector | number[];

interface UIParams {
    name: string;
    type: string;
    position: any;
    size: any;
    anchor: mod.UIAnchor;
    parent: mod.UIWidget;
    visible: boolean;
    textLabel: string;
    textColor: UIVector;
    textAlpha: number;
    textSize: number;
    textAnchor: mod.UIAnchor;
    padding: number;
    bgColor: UIVector;
    bgAlpha: number;
    bgFill: mod.UIBgFill;
    imageType: mod.UIImageType;
    imageColor: UIVector;
    imageAlpha: number;
    teamId?: mod.Team;
    playerId?: mod.Player;
    children?: any[];
    buttonEnabled: boolean;
    buttonColorBase: UIVector;
    buttonAlphaBase: number;
    buttonColorDisabled: UIVector;
    buttonAlphaDisabled: number;
    buttonColorPressed: UIVector;
    buttonAlphaPressed: number;
    buttonColorHover: UIVector;
    buttonAlphaHover: number;
    buttonColorFocused: UIVector;
    buttonAlphaFocused: number;
}

function __asModVector(param: number[]|mod.Vector) {
    if (Array.isArray(param))
        return mod.CreateVector(param[0], param[1], param.length == 2 ? 0 : param[2]);
    else
        return param;
}

function __asModMessage(param: string|mod.Message) {
    if (typeof (param) === "string")
        return mod.Message(param);
    return param;
}

function __fillInDefaultArgs(params: UIParams) {
    if (!params.hasOwnProperty('name'))
        params.name = "";
    if (!params.hasOwnProperty('position'))
        params.position = mod.CreateVector(0, 0, 0);
    if (!params.hasOwnProperty('size'))
        params.size = mod.CreateVector(100, 100, 0);
    if (!params.hasOwnProperty('anchor'))
        params.anchor = mod.UIAnchor.TopLeft;
    if (!params.hasOwnProperty('parent'))
        params.parent = mod.GetUIRoot();
    if (!params.hasOwnProperty('visible'))
        params.visible = true;
    if (!params.hasOwnProperty('padding'))
        params.padding = (params.type == "Container") ? 0 : 8;
    if (!params.hasOwnProperty('bgColor'))
        params.bgColor = mod.CreateVector(0.25, 0.25, 0.25);
    if (!params.hasOwnProperty('bgAlpha'))
        params.bgAlpha = 0.5;
    if (!params.hasOwnProperty('bgFill'))
        params.bgFill = mod.UIBgFill.Solid;
}

function __setNameAndGetWidget(uniqueName: any, params: any) {
    let widget = mod.FindUIWidgetWithName(uniqueName) as mod.UIWidget;
    mod.SetUIWidgetName(widget, params.name);
    return widget;
}

const __cUniqueName = "----uniquename----";

function __addUIContainer(params: UIParams) {
    __fillInDefaultArgs(params);
    let restrict = params.teamId ?? params.playerId;
    if (restrict) {
        mod.AddUIContainer(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            restrict);
    } else {
        mod.AddUIContainer(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill);
    }
    let widget = __setNameAndGetWidget(__cUniqueName, params);
    if (params.children) {
        params.children.forEach((childParams: any) => {
            childParams.parent = widget;
            __addUIWidget(childParams);
        });
    }
    return widget;
}

function __fillInDefaultTextArgs(params: UIParams) {
    if (!params.hasOwnProperty('textLabel'))
        params.textLabel = "";
    if (!params.hasOwnProperty('textSize'))
        params.textSize = 0;
    if (!params.hasOwnProperty('textColor'))
        params.textColor = mod.CreateVector(1, 1, 1);
    if (!params.hasOwnProperty('textAlpha'))
        params.textAlpha = 1;
    if (!params.hasOwnProperty('textAnchor'))
        params.textAnchor = mod.UIAnchor.CenterLeft;
}

function __addUIText(params: UIParams) {
    __fillInDefaultArgs(params);
    __fillInDefaultTextArgs(params);
    let restrict = params.teamId ?? params.playerId;
    if (restrict) {
        mod.AddUIText(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            __asModMessage(params.textLabel),
            params.textSize,
            __asModVector(params.textColor),
            params.textAlpha,
            params.textAnchor,
            restrict);
    } else {
        mod.AddUIText(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            __asModMessage(params.textLabel),
            params.textSize,
            __asModVector(params.textColor),
            params.textAlpha,
            params.textAnchor);
    }
    return __setNameAndGetWidget(__cUniqueName, params);
}

function __fillInDefaultImageArgs(params: any) {
    if (!params.hasOwnProperty('imageType'))
        params.imageType = mod.UIImageType.None;
    if (!params.hasOwnProperty('imageColor'))
        params.imageColor = mod.CreateVector(1, 1, 1);
    if (!params.hasOwnProperty('imageAlpha'))
        params.imageAlpha = 1;
}

function __addUIImage(params: UIParams) {
    __fillInDefaultArgs(params);
    __fillInDefaultImageArgs(params);
    let restrict = params.teamId ?? params.playerId;
    if (restrict) {
        mod.AddUIImage(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            params.imageType,
            __asModVector(params.imageColor),
            params.imageAlpha,
            restrict);
    } else {
        mod.AddUIImage(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            params.imageType,
            __asModVector(params.imageColor),
            params.imageAlpha);
    }
    return __setNameAndGetWidget(__cUniqueName, params);
}

function __fillInDefaultArg(params: any, argName: any, defaultValue: any) {
    if (!params.hasOwnProperty(argName))
        params[argName] = defaultValue;
}

function __fillInDefaultButtonArgs(params: any) {
    if (!params.hasOwnProperty('buttonEnabled'))
        params.buttonEnabled = true;
    if (!params.hasOwnProperty('buttonColorBase'))
        params.buttonColorBase = mod.CreateVector(0.7, 0.7, 0.7);
    if (!params.hasOwnProperty('buttonAlphaBase'))
        params.buttonAlphaBase = 1;
    if (!params.hasOwnProperty('buttonColorDisabled'))
        params.buttonColorDisabled = mod.CreateVector(0.2, 0.2, 0.2);
    if (!params.hasOwnProperty('buttonAlphaDisabled'))
        params.buttonAlphaDisabled = 0.5;
    if (!params.hasOwnProperty('buttonColorPressed'))
        params.buttonColorPressed = mod.CreateVector(0.25, 0.25, 0.25);
    if (!params.hasOwnProperty('buttonAlphaPressed'))
        params.buttonAlphaPressed = 1;
    if (!params.hasOwnProperty('buttonColorHover'))
        params.buttonColorHover = mod.CreateVector(1,1,1);
    if (!params.hasOwnProperty('buttonAlphaHover'))
        params.buttonAlphaHover = 1;
    if (!params.hasOwnProperty('buttonColorFocused'))
        params.buttonColorFocused = mod.CreateVector(1,1,1);
    if (!params.hasOwnProperty('buttonAlphaFocused'))
        params.buttonAlphaFocused = 1;
}

function __addUIButton(params: UIParams) {
    __fillInDefaultArgs(params);
    __fillInDefaultButtonArgs(params);
    let restrict = params.teamId ?? params.playerId;
    if (restrict) {
        mod.AddUIButton(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            params.buttonEnabled,
            __asModVector(params.buttonColorBase), params.buttonAlphaBase,
            __asModVector(params.buttonColorDisabled), params.buttonAlphaDisabled,
            __asModVector(params.buttonColorPressed), params.buttonAlphaPressed,
            __asModVector(params.buttonColorHover), params.buttonAlphaHover,
            __asModVector(params.buttonColorFocused), params.buttonAlphaFocused,
            restrict);
    } else {
        mod.AddUIButton(__cUniqueName,
            __asModVector(params.position),
            __asModVector(params.size),
            params.anchor,
            params.parent,
            params.visible,
            params.padding,
            __asModVector(params.bgColor),
            params.bgAlpha,
            params.bgFill,
            params.buttonEnabled,
            __asModVector(params.buttonColorBase), params.buttonAlphaBase,
            __asModVector(params.buttonColorDisabled), params.buttonAlphaDisabled,
            __asModVector(params.buttonColorPressed), params.buttonAlphaPressed,
            __asModVector(params.buttonColorHover), params.buttonAlphaHover,
            __asModVector(params.buttonColorFocused), params.buttonAlphaFocused);
    }
    return __setNameAndGetWidget(__cUniqueName, params);
}

function __addUIWidget(params: UIParams) {
    if (params == null)
        return undefined;
    if (params.type == "Container")
        return __addUIContainer(params);
    else if (params.type == "Text")
        return __addUIText(params);
    else if (params.type == "Image")
        return __addUIImage(params);
    else if (params.type == "Button")
        return __addUIButton(params);
    return undefined;
}

export function ParseUI(...params: any[]) {
    let widget: mod.UIWidget|undefined;
    for (let a = 0; a < params.length; a++) {
        widget = __addUIWidget(params[a] as UIParams);
    }
    return (globalThis as any)['libModule'].ParseUI(params);
    return widget;
}