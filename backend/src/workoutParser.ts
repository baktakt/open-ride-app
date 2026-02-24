import * as fs from 'fs';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';

// Workout element types
export interface TextEvent {
  timeoffset: number;
  message: string;
}

export interface BaseWorkoutElement {
  type: string;
  duration: number;
  cadence?: number;
  textEvents: TextEvent[];
}

export interface WarmupElement extends BaseWorkoutElement {
  type: 'Warmup';
  powerLow: number;
  powerHigh: number;
}

export interface CooldownElement extends BaseWorkoutElement {
  type: 'Cooldown';
  powerLow: number;
  powerHigh: number;
}

export interface SteadyStateElement extends BaseWorkoutElement {
  type: 'SteadyState';
  power: number;
}

export interface RampElement extends BaseWorkoutElement {
  type: 'Ramp';
  powerLow: number;
  powerHigh: number;
}

export interface IntervalsElement extends BaseWorkoutElement {
  type: 'IntervalsT';
  repeat: number;
  onDuration: number;
  offDuration: number;
  onPower: number;
  offPower: number;
  cadence?: number;
  cadenceResting?: number;
}

export interface FreeRideElement extends BaseWorkoutElement {
  type: 'FreeRide';
  flatRoad?: boolean;
}

export interface MaxEffortElement extends BaseWorkoutElement {
  type: 'MaxEffort';
}

export type WorkoutElement = 
  | WarmupElement 
  | CooldownElement 
  | SteadyStateElement 
  | RampElement 
  | IntervalsElement 
  | FreeRideElement
  | MaxEffortElement;

export interface Workout {
  id: string;
  name: string;
  author: string;
  description: string;
  sportType: string;
  category: string;
  subcategory?: string;
  tags: string[];
  totalDuration: number; // in seconds
  elements: WorkoutElement[];
  filePath: string;
}

export interface WorkoutSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  category: string;
  subcategory?: string;
  tags: string[];
  totalDuration: number;
  estimatedTSS?: number; // Training Stress Score estimate
  chartProfile?: number[]; // Power profile for visualization (FTP percentages)
}

// Parse text events from an element
function parseTextEvents(element: any): TextEvent[] {
  if (!element.textevent) return [];
  
  const events = Array.isArray(element.textevent) ? element.textevent : [element.textevent];
  
  return events.map((event: any) => ({
    timeoffset: parseFloat(event['@_timeoffset'] || '0'),
    message: event['@_message'] || '',
  }));
}

// Calculate total duration of a workout
function calculateTotalDuration(elements: WorkoutElement[]): number {
  return elements.reduce((total, element) => {
    if (element.type === 'IntervalsT') {
      const intervals = element as IntervalsElement;
      return total + (intervals.onDuration + intervals.offDuration) * intervals.repeat;
    }
    return total + element.duration;
  }, 0);
}

// Estimate TSS (Training Stress Score)
function estimateTSS(elements: WorkoutElement[], durationSeconds: number): number {
  let intensityFactorSum = 0;
  let totalTime = 0;
  
  elements.forEach(element => {
    let avgPower: number;
    let elementDuration: number;
    
    switch (element.type) {
      case 'Warmup':
      case 'Cooldown':
      case 'Ramp':
        avgPower = ((element as WarmupElement).powerLow + (element as WarmupElement).powerHigh) / 2;
        elementDuration = element.duration;
        break;
      case 'SteadyState':
        avgPower = (element as SteadyStateElement).power;
        elementDuration = element.duration;
        break;
      case 'IntervalsT':
        const intervals = element as IntervalsElement;
        const onTime = intervals.onDuration * intervals.repeat;
        const offTime = intervals.offDuration * intervals.repeat;
        avgPower = (intervals.onPower * onTime + intervals.offPower * offTime) / (onTime + offTime);
        elementDuration = onTime + offTime;
        break;
      case 'FreeRide':
        avgPower = 0.65; // Assume moderate effort
        elementDuration = element.duration;
        break;
      case 'MaxEffort':
        avgPower = 1.2; // Assume 120% FTP
        elementDuration = element.duration;
        break;
    }
    
    intensityFactorSum += avgPower * elementDuration;
    totalTime += elementDuration;
  });
  
  const avgIntensityFactor = intensityFactorSum / totalTime;
  const normalizedPower = avgIntensityFactor;
  const durationHours = durationSeconds / 3600;
  
  // TSS = (duration in seconds × NP × IF) / (FTP × 3600) × 100
  // Simplified: TSS ≈ duration_hours × IF^2 × 100
  return Math.round(durationHours * Math.pow(normalizedPower, 2) * 100);
}

// Supported workout element type names
const WORKOUT_ELEMENT_TYPES = ['Warmup', 'Cooldown', 'SteadyState', 'Ramp', 'IntervalsT', 'FreeRide', 'MaxEffort'];

// Regex for detecting workout element opening tags in raw XML (used for order-preserving parsing)
const ELEMENT_ORDER_REGEX = new RegExp(`<(${WORKOUT_ELEMENT_TYPES.join('|')})[\\s>]`, 'g');

// Parse a single workout element
function parseWorkoutElement(name: string, element: any): WorkoutElement | null {
  const textEvents = parseTextEvents(element);
  const baseCadence = element['@_Cadence'] ? parseInt(element['@_Cadence']) : undefined;
  
  switch (name) {
    case 'Warmup':
      return {
        type: 'Warmup',
        duration: parseInt(element['@_Duration'] || '0'),
        powerLow: parseFloat(element['@_PowerLow'] || '0.4'),
        powerHigh: parseFloat(element['@_PowerHigh'] || '0.7'),
        cadence: baseCadence,
        textEvents,
      };
      
    case 'Cooldown':
      return {
        type: 'Cooldown',
        duration: parseInt(element['@_Duration'] || '0'),
        powerLow: parseFloat(element['@_PowerLow'] || '0.4'),
        powerHigh: parseFloat(element['@_PowerHigh'] || '0.5'),
        cadence: baseCadence,
        textEvents,
      };
      
    case 'SteadyState':
      return {
        type: 'SteadyState',
        duration: parseInt(element['@_Duration'] || '0'),
        power: parseFloat(element['@_Power'] || '0.6'),
        cadence: baseCadence,
        textEvents,
      };
      
    case 'Ramp':
      return {
        type: 'Ramp',
        duration: parseInt(element['@_Duration'] || '0'),
        powerLow: parseFloat(element['@_PowerLow'] || '0.5'),
        powerHigh: parseFloat(element['@_PowerHigh'] || '0.8'),
        cadence: baseCadence,
        textEvents,
      };
      
    case 'IntervalsT':
      return {
        type: 'IntervalsT',
        duration: 0, // Will be calculated
        repeat: parseInt(element['@_Repeat'] || '1'),
        onDuration: parseInt(element['@_OnDuration'] || '60'),
        offDuration: parseInt(element['@_OffDuration'] || '60'),
        onPower: parseFloat(element['@_OnPower'] || '1.0'),
        offPower: parseFloat(element['@_OffPower'] || '0.5'),
        cadence: baseCadence,
        cadenceResting: element['@_CadenceResting'] ? parseInt(element['@_CadenceResting']) : undefined,
        textEvents,
      };
      
    case 'FreeRide':
      return {
        type: 'FreeRide',
        duration: parseInt(element['@_Duration'] || '0'),
        flatRoad: element['@_FlatRoad'] === '1',
        cadence: baseCadence,
        textEvents,
      };
      
    case 'MaxEffort':
      return {
        type: 'MaxEffort',
        duration: parseInt(element['@_Duration'] || '30'),
        cadence: baseCadence,
        textEvents,
      };
      
    default:
      return null;
  }
}

// Parse a workout file
export function parseWorkoutFile(filePath: string): Workout | null {
  try {
    const xmlContent = fs.readFileSync(filePath, 'utf-8');
    
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    
    const result = parser.parse(xmlContent);
    const workoutFile = result.workout_file;
    
    if (!workoutFile) {
      console.error('Invalid workout file: missing workout_file root element');
      return null;
    }
    
    const workout = workoutFile.workout;
    if (!workout) {
      console.error('Invalid workout file: missing workout element');
      return null;
    }
    
    // Parse tags
    const tags: string[] = [];
    if (workoutFile.tags?.tag) {
      const tagElements = Array.isArray(workoutFile.tags.tag) 
        ? workoutFile.tags.tag 
        : [workoutFile.tags.tag];
      tagElements.forEach((tag: any) => {
        if (tag['@_name']) {
          tags.push(tag['@_name']);
        }
      });
    }
    
    // Parse workout elements
    const elements: WorkoutElement[] = [];

    // Collect parsed data grouped by type (fast-xml-parser merges same-type siblings into arrays)
    const groupedData: Record<string, any[]> = {};
    for (const key of Object.keys(workout)) {
      if (WORKOUT_ELEMENT_TYPES.includes(key)) {
        const elementData = workout[key];
        groupedData[key] = Array.isArray(elementData) ? elementData : [elementData];
      }
    }

    // Restore the original XML document order by scanning the raw XML for opening tags
    const counters: Record<string, number> = {};
    ELEMENT_ORDER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ELEMENT_ORDER_REGEX.exec(xmlContent)) !== null) {
      const typeName = match[1];
      if (groupedData[typeName]) {
        const idx = counters[typeName] ?? 0;
        if (idx < groupedData[typeName].length) {
          const element = parseWorkoutElement(typeName, groupedData[typeName][idx]);
          if (element) {
            elements.push(element);
          }
          counters[typeName] = idx + 1;
        }
      }
    }
    
    const totalDuration = calculateTotalDuration(elements);
    const id = path.basename(filePath, '.orw');
    
    return {
      id,
      name: workoutFile.name || 'Untitled Workout',
      author: workoutFile.author || 'Unknown',
      description: workoutFile.description || '',
      sportType: workoutFile.sportType || 'bike',
      category: workoutFile.category || 'Uncategorized',
      subcategory: workoutFile.subcategory,
      tags,
      totalDuration,
      elements,
      filePath,
    };
  } catch (error) {
    console.error(`Error parsing workout file ${filePath}:`, error);
    return null;
  }
}

// Load all workouts from a directory
export function loadAllWorkouts(workoutsDir: string): Workout[] {
  const workouts: Workout[] = [];
  
  try {
    if (!fs.existsSync(workoutsDir)) {
      console.warn(`Workouts directory does not exist: ${workoutsDir}`);
      return workouts;
    }
    
    const files = fs.readdirSync(workoutsDir);
    
    for (const file of files) {
      if (file.endsWith('.orw')) {
        const filePath = path.join(workoutsDir, file);
        const workout = parseWorkoutFile(filePath);
        if (workout) {
          workouts.push(workout);
        }
      }
    }
    
    console.log(`Loaded ${workouts.length} workouts from ${workoutsDir}`);
  } catch (error) {
    console.error('Error loading workouts:', error);
  }
  
  return workouts;
}

// Generate chart profile from workout elements (array of power values as FTP percentages)
function generateChartProfile(elements: WorkoutElement[], numBars: number = 20): number[] {
  const profile: number[] = [];

  if (!elements || elements.length === 0) {
    return Array(numBars).fill(0.5);
  }

  // Build a time-based power profile
  const powerSegments: { duration: number; power: number }[] = [];

  for (const element of elements) {
    if (element.type === 'IntervalsT') {
      for (let rep = 0; rep < element.repeat; rep++) {
        powerSegments.push({ duration: element.onDuration, power: element.onPower });
        powerSegments.push({ duration: element.offDuration, power: element.offPower });
      }
    } else if (element.type === 'Ramp' || element.type === 'Warmup' || element.type === 'Cooldown') {
      const steps = Math.max(2, Math.ceil(element.duration / 60));
      const stepDuration = element.duration / steps;
      for (let i = 0; i < steps; i++) {
        const progress = i / (steps - 1 || 1);
        const power = (element.powerLow || 0.5) + ((element.powerHigh || 0.5) - (element.powerLow || 0.5)) * progress;
        powerSegments.push({ duration: stepDuration, power });
      }
    } else if (element.type === 'SteadyState') {
      powerSegments.push({ duration: element.duration, power: element.power });
    } else {
      // FreeRide, MaxEffort - use a default power
      powerSegments.push({ duration: element.duration, power: 0.5 });
    }
  }

  const totalDuration = powerSegments.reduce((sum, seg) => sum + seg.duration, 0);
  if (totalDuration === 0) {
    return Array(numBars).fill(0.5);
  }

  const barDuration = totalDuration / numBars;

  for (let i = 0; i < numBars; i++) {
    const targetTime = (i + 0.5) * barDuration;
    let currentTime = 0;
    let power = 0.5;

    for (const seg of powerSegments) {
      if (currentTime + seg.duration > targetTime) {
        power = seg.power;
        break;
      }
      currentTime += seg.duration;
    }

    profile.push(power);
  }

  return profile;
}

// Get workout summaries (for listing)
export function getWorkoutSummaries(workouts: Workout[]): WorkoutSummary[] {
  return workouts.map(workout => ({
    id: workout.id,
    name: workout.name,
    author: workout.author,
    description: workout.description,
    category: workout.category,
    subcategory: workout.subcategory,
    tags: workout.tags,
    totalDuration: workout.totalDuration,
    estimatedTSS: estimateTSS(workout.elements, workout.totalDuration),
    chartProfile: generateChartProfile(workout.elements),
  }));
}

// Format duration as human readable string
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Get categories from workouts
export function getCategories(workouts: Workout[]): string[] {
  const categories = new Set<string>();
  workouts.forEach(w => categories.add(w.category));
  return Array.from(categories).sort();
}

// Filter workouts by category
export function filterByCategory(workouts: Workout[], category: string): Workout[] {
  return workouts.filter(w => w.category === category);
}

// Filter workouts by tag
export function filterByTag(workouts: Workout[], tag: string): Workout[] {
  return workouts.filter(w => w.tags.includes(tag));
}

// Search workouts by name or description
export function searchWorkouts(workouts: Workout[], query: string): Workout[] {
  const lowerQuery = query.toLowerCase();
  return workouts.filter(w => 
    w.name.toLowerCase().includes(lowerQuery) ||
    w.description.toLowerCase().includes(lowerQuery)
  );
}
