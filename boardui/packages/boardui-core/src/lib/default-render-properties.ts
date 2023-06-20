import { RenderProperties } from "./render-properties";

export const DEFAULT_RENDER_PROPERTIES: RenderProperties = {
  padding: 0.5,
  dropShadow: {
    dx: 0,
    dy: 0,
    stdDeviation: 0.02,
  },
  layerTypesRenderProperties: [
    {
      layerType: 'PROFILE',
      color: {
        r: 26,
        g: 80,
        b: 26,
      },
    },
    {
      layerType: 'SIGNAL',
      color: {
        r: 55,
        g: 105,
        b: 48,
      },
    },
    {
      layerType: 'COMPONENT',
      color: {
        r: 200,
        g: 140,
        b: 48,
      },
    },
    {
      layerType: 'SILKSCREEN',
      color: {
        r: 255,
        g: 255,
        b: 255,
      },
    },
    {
      layerType: 'DRILL',
    },
  ],
  componentRenderProperties: []
};