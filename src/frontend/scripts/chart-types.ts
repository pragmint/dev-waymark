// Minimal Chart.js type definitions for global Chart object

export interface DataPointMetadata {
  [key: string]: string | number | boolean | undefined;
}

export interface ChartDataset {
  label: string;
  data: (number | null)[];
  borderColor: string;
  backgroundColor: string;
  yAxisID?: string;
  metadata?: (DataPointMetadata | undefined)[];
}

export interface QualitativeDataPoint {
  date: string;
  value: string;
  metadata?: DataPointMetadata;
}

export interface ChartData {
  labels: string[];
  datasets: ChartDataset[];
  qualitativeData?: QualitativeDataPoint[];
}

export interface ChartAxisTicks {
  maxRotation?: number;
  minRotation?: number;
}

export interface ChartAxis {
  beginAtZero?: boolean;
  ticks?: ChartAxisTicks;
  grace?: string;
  min?: number;
  max?: number;
  position?: 'left' | 'right' | 'top' | 'bottom';
  title?: {
    display: boolean;
    text: string;
  };
}

export interface ChartScales {
  x?: ChartAxis;
  y?: ChartAxis;
  y1?: ChartAxis;
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

export interface AnnotationBoxOptions {
  type: 'box';
  xMin: number;
  xMax: number;
  yMin?: number | string;
  yMax?: number | string;
  backgroundColor: string;
  borderColor?: string;
  borderWidth?: number;
  label?: {
    display: boolean;
    content: string;
    position?: string;
  };
  enter?: (context: { element: unknown }) => void;
  leave?: (context: { element: unknown }) => void;
}

export interface AnnotationPluginOptions {
  annotations: Record<string, AnnotationBoxOptions>;
}

export interface TooltipCallbacks {
  afterBody?: (context: TooltipContext[]) => string | string[];
}

export interface TooltipOptions {
  callbacks?: TooltipCallbacks;
}

export interface TooltipContext {
  chart: unknown;
  label: string;
  parsed: { x: number; y: number };
  formattedValue: string;
  dataset: ChartDataset;
  datasetIndex: number;
  dataIndex: number;
  raw: number | null;
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
  annotation?: AnnotationPluginOptions;
  tooltip?: TooltipOptions;
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
  zoom(scaleFactor: number): void;
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
