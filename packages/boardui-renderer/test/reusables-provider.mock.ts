import { FillDesc, Package } from '../../boardui-parser/src';
import { ReusablesProvider } from '../src/lib/reusables-provider';
import { getPolygon } from './polygonUtils';

export const ReusablesProviderMock: ReusablesProvider = {
  getFillDescById: (): FillDesc => ({
    fillProperty: 'FILL',
    lineWidth: 1,
    pitch1: 2,
    pitch2: 3,
    angle1: 4,
    angle2: 5,
    color: {
      r: 6,
      g: 7,
      b: 8,
    },
  }),
  getLayerByName: function (name: string) {
    throw new Error('Function not implemented.');
  },
  getColorById: function (colorId: string) {
    throw new Error('Function not implemented.');
  },
  getLineDescById: function (lineDescId: string) {
    throw new Error('Function not implemented.');
  },
  getPrimitiveById: function (primitiveId: string) {
    throw new Error('Function not implemented.');
  },
  getPackageByName: function (name: string) {
    const testPackage = new Package();
    testPackage.outline = {
      polygon: getPolygon([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
      lineDesc: {
        lineEnd: 'ROUND',
        lineWidth: '1',
        lineProperty: 'SOLID',
      },
    };

    return testPackage;
  },
};
