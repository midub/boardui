import { ElementIdProvider } from '../src/lib';

export const ElementIdProviderMock: ElementIdProvider = {
  getElementId: (element: any): number => 1,
};
