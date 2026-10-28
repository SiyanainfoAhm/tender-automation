// Advance only after the result is durable. A terminated worker repeats at most one page.
export async function processPageBatch(state,total,budget,readPage,save){
 state.pages??={};state.cursor??=1;state.total_pages=total;
 while(state.cursor<=total&&budget.native>0){
  const page=state.cursor;
  state.pages[page]=await readPage(page);
  state.cursor++;budget.native--;
  await save();
 }
 state.done=state.cursor>total;
}
