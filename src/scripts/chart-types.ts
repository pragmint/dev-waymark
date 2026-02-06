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
}

export interface ChartScales {
  x?: ChartAxis;
  y?: ChartAxis;
}

export interface ChartPlugins {
  legend: {
    position: 'top' | 'bottom' | 'left' | 'right';
  };
  title: {
    display: boolean;
    text: string;
  };
}

export interface ChartOptions {
  responsive: boolean;
  maintainAspectRatio: boolean;
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
