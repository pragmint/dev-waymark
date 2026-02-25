// Minimal Chart.js type definitions for global Chart object

export interface ChartDataset {
  label: string;
  data: (number | null)[];
  borderColor: string;
  backgroundColor: string;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
}

export interface ChartAxisTicks {
  maxRotation?: number;
  minRotation?: number;
}

export interface ChartAxis {
  beginAtZero?: boolean;
  ticks?: ChartAxisTicks;
  grace?: string;
}

export interface ChartScales {
  x?: ChartAxis;
  y?: ChartAxis;
}

export interface ZoomAnimation {
  duration: number;
  easing: string;
}

export interface ZoomAxisLimits {
  min?: number;
  max?: number;
  minRange?: number;
}

export interface ZoomPluginOptions {
  limits?: {
    x?: ZoomAxisLimits;
    y?: ZoomAxisLimits;
  };
  zoom: {
    wheel: { enabled: boolean };
    pinch: { enabled: boolean };
    mode: 'x' | 'y' | 'xy';
  };
  pan: {
    enabled: boolean;
    mode: 'x' | 'y' | 'xy';
  };
}

export interface ChartPlugins {
  legend: {
    position: 'top' | 'bottom' | 'left' | 'right';
  };
  title: {
    display: boolean;
    text: string;
  };
  zoom?: ZoomPluginOptions;
}

export interface ChartTransitions {
  zoom?: {
    animation?: ZoomAnimation;
  };
}

export interface ChartOptions {
  responsive: boolean;
  maintainAspectRatio: boolean;
  transitions?: ChartTransitions;
  plugins: ChartPlugins;
  scales: ChartScales;
}

export interface ChartConfiguration {
  type: 'line' | 'bar' | 'pie' | 'doughnut' | 'radar' | 'polarArea' | 'bubble' | 'scatter';
  data: ChartData;
  options: ChartOptions;
}

export interface ChartInstance {
  destroy(): void;
  resetZoom(): void;
}

export interface ChartConstructor {
  new (canvas: HTMLCanvasElement, config: ChartConfiguration): ChartInstance;
}

declare global {
  interface Window {
    Chart: ChartConstructor;
  }
}

export {};
