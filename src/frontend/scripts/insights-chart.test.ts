import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Bun's test runner does not provide a `window` global. Shim it so that the
// module under test can resolve `window.Chart` to the mock we install below.
// This must happen before the module is imported.
(globalThis as unknown as Record<string, unknown>)['window'] = globalThis;

import { ChartManager } from './insights-chart';
import type { ChartConfiguration, ChartInstance } from './chart-types';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A minimal canvas stand-in — ChartManager only stores it and passes it through. */
function makeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement;
}

/** Tracks calls made to a single Chart instance created by the mock constructor. */
interface MockChartInstance extends ChartInstance {
  destroyCalls: number;
}

function makeMockChartInstance(): MockChartInstance {
  return {
    destroyCalls: 0,
    destroy() {
      this.destroyCalls++;
    },
    resetZoom() {},
    zoom(_factor: number) {},
  };
}

/**
 * A factory for the window.Chart mock constructor.
 *
 * Returns both the mock function itself and a way to inspect every instance
 * that has been created so far, along with the config each was given.
 */
function makeChartConstructorMock() {
  const instances: {
    instance: MockChartInstance;
    canvas: HTMLCanvasElement;
    config: ChartConfiguration;
  }[] = [];

  const constructor = mock(
    (canvas: HTMLCanvasElement, config: ChartConfiguration): MockChartInstance => {
      const instance = makeMockChartInstance();
      instances.push({ instance, canvas, config });
      return instance;
    }
  );

  return { constructor, instances };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChartData() {
  return {
    labels: ['Jan', 'Feb', 'Mar'],
    datasets: [
      {
        label: 'Velocity',
        data: [1, 2, 3],
        borderColor: '#000',
        backgroundColor: '#fff',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChartManager', () => {
  let canvas: HTMLCanvasElement;
  let instances: ReturnType<typeof makeChartConstructorMock>['instances'];
  let chartConstructor: ReturnType<typeof makeChartConstructorMock>['constructor'];

  beforeEach(() => {
    canvas = makeCanvas();
    const mock = makeChartConstructorMock();
    instances = mock.instances;
    chartConstructor = mock.constructor;
    // Install the mock as the global Chart constructor that window.Chart resolves to
    (globalThis as unknown as Record<string, unknown>)['Chart'] = chartConstructor;
  });

  afterEach(() => {
    // Remove the global so tests don't bleed into one another
    delete (globalThis as unknown as Record<string, unknown>)['Chart'];
  });

  // -------------------------------------------------------------------------
  // isRendered — initial state
  // -------------------------------------------------------------------------

  describe('isRendered()', () => {
    it('returns false before any render call', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act + Assert
      expect(manager.isRendered()).toBe(false);
      expect(chartConstructor).toHaveBeenCalledTimes(0);
    });

    it('returns true after render is called', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'My Chart');

      // Assert
      expect(manager.isRendered()).toBe(true);
    });

    it('returns false after destroy is called following a render', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'My Chart');

      // Act
      manager.destroy();

      // Assert
      expect(manager.isRendered()).toBe(false);
    });

    it('returns true again after render is called a second time', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'First');
      manager.destroy();

      // Act
      manager.render(makeChartData(), 'Second');

      // Assert
      expect(manager.isRendered()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // destroy() — idempotency and delegation
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('calls destroy() on the underlying chart instance', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'My Chart');
      const chartInstance = instances[0].instance;

      // Act
      manager.destroy();

      // Assert
      expect(chartInstance.destroyCalls).toBe(1);
    });

    it('is a no-op (does not throw) when called with no chart rendered', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act + Assert — should not throw
      expect(() => manager.destroy()).not.toThrow();
      expect(chartConstructor).toHaveBeenCalledTimes(0);
    });

    it('is a no-op when called a second time after the chart is already destroyed', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'My Chart');
      const chartInstance = instances[0].instance;
      manager.destroy();

      // Act
      manager.destroy();

      // Assert — destroy() on the instance must not be called again
      expect(chartInstance.destroyCalls).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // zoomIn() / zoomOut() / resetZoom()
  // -------------------------------------------------------------------------

  describe('zoomIn()', () => {
    it('calls chart.zoom(1.2) on the underlying chart instance', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'My Chart');
      const zoomMock = mock((_factor: number) => {});
      instances[0].instance.zoom = zoomMock;

      // Act
      manager.zoomIn();

      // Assert
      expect(zoomMock).toHaveBeenCalledWith(1.2);
    });

    it('is a no-op when no chart is rendered', () => {
      const manager = new ChartManager(canvas);
      expect(() => manager.zoomIn()).not.toThrow();
    });
  });

  describe('zoomOut()', () => {
    it('calls chart.zoom(1/1.2) on the underlying chart instance', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'My Chart');
      const zoomMock = mock((_factor: number) => {});
      instances[0].instance.zoom = zoomMock;

      // Act
      manager.zoomOut();

      // Assert
      expect(zoomMock).toHaveBeenCalledWith(1 / 1.2);
    });

    it('is a no-op when no chart is rendered', () => {
      const manager = new ChartManager(canvas);
      expect(() => manager.zoomOut()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // render() — Chart constructor invocation
  // -------------------------------------------------------------------------

  describe('render()', () => {
    it('passes the canvas element to the Chart constructor', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const data = makeChartData();

      // Act
      manager.render(data, 'Throughput');

      // Assert
      expect(chartConstructor).toHaveBeenCalledTimes(1);
      expect(instances).toHaveLength(1);
      expect(instances[0].canvas).toBe(canvas);
    });

    it('passes the data to the Chart configuration unchanged', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const data = makeChartData();

      // Act
      manager.render(data, 'Throughput');

      // Assert
      expect(chartConstructor).toHaveBeenCalledTimes(1);
      expect(instances[0].config.data).toEqual(data);
    });

    it('passes the title string into the chart title plugin config', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Deployment Frequency');

      // Assert
      const config = instances[0].config;
      expect(config.options.plugins.title.text).toBe('Deployment Frequency');
      expect(config.options.plugins.title.display).toBe(true);
    });

    it('sets type to "line" when any dataset has more than one data point', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Any Title'); // data: [1, 2, 3]

      // Assert
      expect(instances[0].config.type).toBe('line');
    });

    it('sets type to "bar" when every dataset has exactly one data point', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const singlePointData = {
        labels: ['Jan'],
        datasets: [{ label: 'X', data: [5], borderColor: '#000', backgroundColor: '#fff' }],
      };

      // Act
      manager.render(singlePointData, 'Any Title');

      // Assert
      expect(instances[0].config.type).toBe('bar');
    });

    it('sets type to "line" when at least one dataset has multiple points', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const mixedData = {
        labels: ['Jan', 'Feb'],
        datasets: [
          { label: 'Single', data: [1], borderColor: '#000', backgroundColor: '#fff' },
          { label: 'Multi', data: [1, 2], borderColor: '#111', backgroundColor: '#eee' },
        ],
      };

      // Act
      manager.render(mixedData, 'Any Title');

      // Assert
      expect(instances[0].config.type).toBe('line');
    });

    it('sets type to "bar" when all datasets are empty', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const emptyData = {
        labels: [],
        datasets: [{ label: 'X', data: [], borderColor: '#000', backgroundColor: '#fff' }],
      };

      // Act
      manager.render(emptyData, 'Any Title');

      // Assert
      expect(instances[0].config.type).toBe('bar');
    });

    it('sets maintainAspectRatio to false', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Any Title');

      // Assert
      expect(instances[0].config.options.maintainAspectRatio).toBe(false);
    });

    it('sets responsive to true', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Any Title');

      // Assert
      expect(instances[0].config.options.responsive).toBe(true);
    });

    it('positions the legend at the top', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Any Title');

      // Assert
      expect(instances[0].config.options.plugins.legend.position).toBe('top');
    });

    it('configures the y-axis with beginAtZero false for line charts', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Any Title');

      // Assert
      expect(instances[0].config.options.scales.y?.beginAtZero).toBe(false);
    });

    it('configures the y-axis with beginAtZero true for bar charts', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const singlePointData = {
        labels: ['Jan'],
        datasets: [{ label: 'X', data: [5], borderColor: '#000', backgroundColor: '#fff' }],
      };

      // Act
      manager.render(singlePointData, 'Any Title');

      // Assert
      expect(instances[0].config.options.scales.y?.beginAtZero).toBe(true);
    });

    it('configures x-axis tick rotation between 45 and 90 degrees', () => {
      // Arrange
      const manager = new ChartManager(canvas);

      // Act
      manager.render(makeChartData(), 'Any Title');

      // Assert
      const ticks = instances[0].config.options.scales.x?.ticks;
      expect(ticks?.maxRotation).toBe(90);
      expect(ticks?.minRotation).toBe(45);
    });

    it('calls the Chart constructor with canvas and complete config', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      const data = makeChartData();

      // Act
      manager.render(data, 'Test Title');

      // Assert — verify mock was called with expected signature
      expect(chartConstructor).toHaveBeenCalledTimes(1);
      const [actualCanvas, actualConfig] = chartConstructor.mock.calls[0];
      expect(actualCanvas).toBe(canvas);
      expect(actualConfig).toMatchObject({
        type: 'line',
        data,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
            },
            title: {
              display: true,
              text: 'Test Title',
            },
            zoom: {
              limits: {
                x: { min: 0, max: 2, minRange: 2 },
                y: { min: 0.5, max: 3.5, minRange: 1 },
              },
              zoom: {
                wheel: { enabled: false },
                pinch: { enabled: false },
                mode: 'xy',
              },
              pan: {
                enabled: true,
                mode: 'xy',
              },
            },
          },
          scales: {
            x: {
              ticks: {
                maxRotation: 90,
                minRotation: 45,
              },
            },
            y: {
              beginAtZero: false,
              grace: '10%',
              position: 'left',
              title: undefined,
            },
          },
        },
      });
      // Verify tooltip callbacks are present
      expect(actualConfig.options.plugins.tooltip?.callbacks?.afterBody).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // render() — re-render lifecycle (destroy before creating new instance)
  // -------------------------------------------------------------------------

  describe('render() called on an already-rendered chart', () => {
    it('destroys the previous chart instance before creating a new one', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'First');
      const firstInstance = instances[0].instance;

      // Act
      manager.render(makeChartData(), 'Second');

      // Assert — old instance must have been destroyed exactly once
      expect(firstInstance.destroyCalls).toBe(1);
    });

    it('creates a brand-new chart instance on re-render', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'First');

      // Act
      manager.render(makeChartData(), 'Second');

      // Assert — two Chart instances should have been created in total
      expect(chartConstructor).toHaveBeenCalledTimes(2);
      expect(instances).toHaveLength(2);
    });

    it('reflects the new title after a re-render', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'First');

      // Act
      manager.render(makeChartData(), 'Second');

      // Assert — the second (latest) instance carries the updated title
      expect(instances[1].config.options.plugins.title.text).toBe('Second');
    });

    it('remains in a rendered state after a re-render', () => {
      // Arrange
      const manager = new ChartManager(canvas);
      manager.render(makeChartData(), 'First');

      // Act
      manager.render(makeChartData(), 'Second');

      // Assert
      expect(manager.isRendered()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // render() — axis limits derived from data
  // -------------------------------------------------------------------------

  describe('render() axis limits', () => {
    function getLimits(data: ReturnType<typeof makeChartData>) {
      const manager = new ChartManager(canvas);
      manager.render(data, 'Title');
      return instances[0].config.options.plugins.zoom?.limits;
    }

    it('sets x limits to the label index range', () => {
      // Arrange — 3 labels → indices 0..2
      const limits = getLimits(makeChartData());

      // Assert
      expect(limits?.x?.min).toBe(0);
      expect(limits?.x?.max).toBe(2);
    });

    it('sets x minRange to min(2, label count - 1)', () => {
      const limits = getLimits(makeChartData()); // 3 labels
      expect(limits?.x?.minRange).toBe(2);
    });

    it('sets x minRange to 0 when only one label exists', () => {
      const data = {
        labels: ['Jan'],
        datasets: [{ label: 'A', data: [5], borderColor: '#000', backgroundColor: '#fff' }],
      };
      const manager = new ChartManager(canvas);
      manager.render(data, 'Title');
      expect(instances[0].config.options.plugins.zoom?.limits?.x?.minRange).toBe(0);
    });

    it('derives y limits with 10% padding, floored at 0.5', () => {
      // data [1,2,3]: range=2, 10%=0.2 → floor to 0.5 padding
      const limits = getLimits(makeChartData());
      expect(limits?.y?.min).toBeCloseTo(0.5);
      expect(limits?.y?.max).toBeCloseTo(3.5);
    });

    it('uses 10% padding when range is large enough', () => {
      // data [0, 100]: range=100, 10%=10 > 0.5
      const data = {
        labels: ['A', 'B'],
        datasets: [{ label: 'X', data: [0, 100], borderColor: '#000', backgroundColor: '#fff' }],
      };
      const manager = new ChartManager(canvas);
      manager.render(data, 'Title');
      const limits = instances[0].config.options.plugins.zoom?.limits;
      expect(limits?.y?.min).toBeCloseTo(-10);
      expect(limits?.y?.max).toBeCloseTo(110);
    });

    it('ignores null values when computing y limits', () => {
      // Only non-null values [2, 4] should be considered; range=2, 10%=0.2 → floor to 0.5
      const data = {
        labels: ['A', 'B', 'C'],
        datasets: [
          {
            label: 'X',
            data: [null, 2, 4] as (number | null)[],
            borderColor: '#000',
            backgroundColor: '#fff',
          },
        ],
      };
      const manager = new ChartManager(canvas);
      manager.render(data, 'Title');
      const limits = instances[0].config.options.plugins.zoom?.limits;
      expect(limits?.y?.min).toBeCloseTo(1.5);
      expect(limits?.y?.max).toBeCloseTo(4.5);
    });

    it('falls back to y range [0,1] when all values are null', () => {
      const data = {
        labels: ['A'],
        datasets: [
          {
            label: 'X',
            data: [null] as (number | null)[],
            borderColor: '#000',
            backgroundColor: '#fff',
          },
        ],
      };
      const manager = new ChartManager(canvas);
      manager.render(data, 'Title');
      const limits = instances[0].config.options.plugins.zoom?.limits;
      // yMin=0, yMax=1, range=1, 10%=0.1 → floor to 0.5
      expect(limits?.y?.min).toBeCloseTo(-0.5);
      expect(limits?.y?.max).toBeCloseTo(1.5);
    });
  });
});
