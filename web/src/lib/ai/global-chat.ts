export const GLOBAL_QUESTIONS = [
 'How many tenders are in each status?',
 'Which 10 tenders have the highest chance of winning?',
 'Show tenders where we meet all PQ requirements.',
 'Which Conditional Go tenders should move to GO?',
 'Find the best USA AI and workflow projects.',
 'Why are tenders stuck in Verify?',
 'Which Will Bid tenders have missing documents?',
 'Show tenders closing in the next seven days.',
 'Which tenders were added today?',
 'What should we prioritize today?',
];
export type GlobalPresentation = {
 documents?:{id:string;title:string;href:string;financial_year:string|null;verification_status:string}[];
 summary:string; details:string;
 references:Array<{id:string;title:string;status:string;href:string}>;
 followups:string[];
};
export type GlobalMessage = {id:string;role:'user'|'assistant';content:string;presentation?:GlobalPresentation|null};
