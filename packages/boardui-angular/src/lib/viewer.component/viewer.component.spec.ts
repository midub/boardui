import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ViewerComponent } from './viewer.component';

describe('PcbViewerComponent', () => {
  let component: ViewerComponent;
  let fixture: ComponentFixture<ViewerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ViewerComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /*it('should render pcb', () => {
    component.pcb = { revision: 'C', content: null!, ecad: null!, bom: null! };
    component.step = "testStep";
    component.side = "TOP";
    component.renderProperties = {
      padding: 10,
      dropShadow: {
        dx: 1,
        dy: 2,
        stdDeviation: 3
      },
      layerTypesRenderProperties: [],
      componentRenderProperties: [],
    };

    expect(component).toBeTruthy();
  });*/
});
