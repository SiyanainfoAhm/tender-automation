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

test('2026-10-31 clean-up titles are NO_GO by title',()=>{
 const cases={
  'virtual machine (compute) - public cloud; ubuntu operating system; 16; 8; 1:1; web server; primary dc; 200':'CLOUD_HOSTING_INFRA',
  '- ni labview software package':'SOFTWARE_RESALE',
  'supply, installation, commissioning, maintenance and demonstration of various equipment/software licenses and development tools: - eda tool ':'SOFTWARE_RESALE',
  'development of gls data base for road and storm water drain network of belapur ward':null,
  'development of gis data base for road and storm water drain network of belapur ward for requirement of pm gati shakti and amrut.':'GIS_SURVEY_PROCESSING',
  'request for proposal (rfp) for selection of system integrator (si) for implementation of smart classroom for osepa, school & mass education ':'HARDWARE',
  'request for proposal for supply, implementation, support and maintenance of application programming interface management (apim) platform.':'SOFTWARE_RESALE',
 };
 for(const [t,code] of Object.entries(cases)) assert.equal(titleScreen({title:t})?.rule_code??null,code,t);
});
test('2026-10-31 software tenders still go to the quick screen',()=>{
 for(const t of ['selection of an implementation vendor for design development deployment and manage support of an ai/ml based gst risk analytics platform','engagement of agency for design, development, implementation & maintenance of nhrdf website','selection of system integrator for upgradation and revamping of college management system 2.o cms 2.0','implementation of an on screen evaluation (ose) system for semester-end examination.','procurement of web-based software for the digitization of record files','gis portal development for forest department'])
  assert.equal(titleScreen({title:t}),null,t);
});
