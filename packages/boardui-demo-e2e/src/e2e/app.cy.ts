import { getBOMTable, getFileChooser, getPCBSvg } from '../support/app.po';

describe('boardui-demo', () => {
  beforeEach(() => cy.visit('/'));

  it('should display PCB', () => {
    getPCBSvg().should('exist');
    getPCBSvg().should('be.visible');
  });

  it('should display BOM', () => {
    getBOMTable().should('exist');
    getBOMTable().find('tbody').first().children().should('have.length', 7);
  });

  it('should change file', () => {
    getPCBSvg().should('exist');
    getPCBSvg().invoke('attr', 'step').as('previousStep');

    getFileChooser().selectFile(['src/assets/testcase3-RevC-Assembly.xml'], {
      force: true,
    });

    cy.get('@previousStep').then((step) => {
      getPCBSvg().should('not.have.attr', 'step', step);
      getPCBSvg().should('be.visible');
    });
  });
});
