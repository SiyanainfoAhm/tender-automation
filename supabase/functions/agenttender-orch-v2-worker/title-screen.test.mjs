import test from 'node:test';
import assert from 'node:assert/strict';
import {titleScreen} from './title-screen.mjs';

test('obvious non-fit titles are NO_GO',()=>{
 for(const t of ['- microsoft office professional 2021','- high end laptop - notebook (q2) , antivirus software (q2)','custom bid for services - annual maintenance contract for hitachi make plc system','work of meter reading through mobile app, cmri / mr-9 & bill distribution services','providing dedicated enterprise-grade internet leased-line connectivity','request for proposal for empanelment of agency for providing resources (ctc+margin / fixed cost)'])
  assert.equal(titleScreen({title:t})?.decision,'NO_GO',t);
});
test('software work is never decided by title',()=>{
 for(const t of ['Development of official website for MahaGenco REL along with 3 years AMC','Hiring of Agency for IT Projects- Milestone basis','design, development and implementation of mobile app with dashboard','tender estimated cost & dates are tentative only.','Delhi Manpower','hiring of agency for iso certification service - iso 9001'])
  assert.equal(titleScreen({title:t}),null,t);
});
