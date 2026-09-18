import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AppUpdater, BrandMark, ThemePicker } from "@cinder/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "dashboard" | "people" | "files" | "backup" | "settings";
type PublicState = { configured:boolean; config_error:string|null; running:boolean; school_name:string|null; data_dir:string|null; port:number|null };
type Dashboard = { running:boolean; school_name:string; lan_url:string; data_dir:string; database_bytes:number; files_bytes:number; teachers:number; students:number; classrooms:number; files:number; trashed_files:number; missing_blobs:number; orphaned_blobs:number; duplicate_references:number; last_backup:string|null; bootstrap_pin:string|null };
type Person = { id:string; username:string; display_name:string; role:string; disabled_at:string|null; last_login:string|null; classrooms:string };
type StoredFile = { node_id:string; display_name:string; original_name:string; mime:string; bytes:number; sha256:string; owner:string|null; classroom:string|null; created_at:string; references:number; trashed_at:string|null; missing:boolean };
type SetupResult = { recovery_code:string; bootstrap_pin:string|null };
type AuditEntry = { id:number; action:string; detail:string; target_id:string|null; created_at:string };
type AiSettings = { base_url?:string; model:string; has_key:boolean; reachable:boolean; has_google_key:boolean; google_model:string };
type GoogleModel = { id:string; display_name:string; description:string };
type AiUsage = { requests:number; input_tokens:number; output_tokens:number; lifetime_requests:number; lifetime_input_tokens:number; lifetime_output_tokens:number; monthly_token_limit:number|null };

const tabs: {id:Tab; label:string}[] = [
  {id:"dashboard",label:"Dashboard"},{id:"people",label:"People"},{id:"files",label:"Stored files"},{id:"backup",label:"Backup & recovery"},{id:"settings",label:"Settings"},
];
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const formatBytes = (value:number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value/1024).toFixed(1)} KB` : value < 1073741824 ? `${(value/1048576).toFixed(1)} MB` : `${(value/1073741824).toFixed(1)} GB`;
const fmt = (value:string|null) => value ? new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)) : "Never";

export function App(){
  const [publicState,setPublicState]=useState<PublicState|null>(null);
  const [token,setToken]=useState("");
  const [tab,setTab]=useState<Tab>("dashboard");
  const [message,setMessage]=useState("");
  const refreshPublic=useCallback(()=>invoke<PublicState>("public_state").then(setPublicState),[]);
  const lockAdmin=useCallback(()=>{setToken("");setMessage("");void invoke("lock")},[]);
  useEffect(()=>{void refreshPublic()},[refreshPublic]);
  useEffect(()=>{if(!token)return;let timeout=window.setTimeout(lockAdmin,15*60*1000);const touch=()=>{window.clearTimeout(timeout);timeout=window.setTimeout(lockAdmin,15*60*1000)};const hide=()=>{if(document.hidden)setMessage("")};for(const event of ["pointerdown","keydown"] as const)window.addEventListener(event,touch);document.addEventListener("visibilitychange",hide);return()=>{window.clearTimeout(timeout);for(const event of ["pointerdown","keydown"] as const)window.removeEventListener(event,touch);document.removeEventListener("visibilitychange",hide)}},[token,lockAdmin]);
  if(!publicState) return <main className="host-centre"><BrandMark size={56}/><p>Opening Cinder Host…</p></main>;
  if(publicState.config_error) return <main className="host-centre"><section className="auth-sheet compact"><BrandMark size={52}/><h1>Host configuration is locked</h1><p className="error">{publicState.config_error}</p><p>Cinder will not create a new school over an unreadable configuration.</p></section></main>;
  if(!publicState.configured) return <Setup onDone={(result)=>{setMessage(`Save this Host recovery code: ${result.recovery_code}${result.bootstrap_pin?`\nTeacher setup PIN: ${result.bootstrap_pin}`:""}`);void refreshPublic()}}/>;
  if(!token) return <Unlock schoolName={publicState.school_name??"Cinder School"} message={message} onUnlock={setToken} onRecovered={(value)=>setMessage(`Save the new recovery code: ${value}`)}/>;
  return <HostShell tab={tab} setTab={setTab} token={token} state={publicState} refreshPublic={refreshPublic} lock={lockAdmin} />;
}

function Setup({onDone}:{onDone:(value:SetupResult)=>void}){
  const [school,setSchool]=useState("");const [folder,setFolder]=useState("");const [password,setPassword]=useState("");const [port,setPort]=useState(7373);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function choose(){const value=await open({directory:true,multiple:false,title:"Choose where school data is stored"});if(typeof value==="string")setFolder(value)}
  async function submit(e:React.FormEvent){e.preventDefault();setBusy(true);setError("");try{onDone(await invoke("setup_host",{dataDir:folder,schoolName:school,password,port}))}catch(e){setError(errorText(e))}finally{setBusy(false)}}
  return <main className="host-centre"><form className="auth-sheet" onSubmit={submit}><BrandMark size={58}/><div><h1>Set up Cinder Host</h1><p>This computer will hold the school’s accounts, work and files.</p></div><label>School name<input value={school} onChange={e=>setSchool(e.target.value)} required/></label><label>School data folder<span className="picker"><input value={folder} readOnly required/><button type="button" onClick={choose}>Choose</button></span></label><label>Host password<input type="password" value={password} minLength={8} onChange={e=>setPassword(e.target.value)} required/><small>At least 8 characters. This protects local administration.</small></label><label>Network port<input type="number" min={1024} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))}/></label>{error&&<p className="error">{error}</p>}<button className="primary" disabled={busy}>{busy?"Setting up…":"Set up Host"}</button></form></main>
}

function Unlock({schoolName,message,onUnlock,onRecovered}:{schoolName:string;message:string;onUnlock:(token:string)=>void;onRecovered:(code:string)=>void}){
  const [password,setPassword]=useState("");const [error,setError]=useState("");const [recovery,setRecovery]=useState(false);
  async function submit(e:React.FormEvent){e.preventDefault();setError("");try{if(recovery){const code=prompt("Enter the current Host recovery code")??"";const result=await invoke<SetupResult>("unlock_with_recovery",{recoveryCode:code,newPassword:password});onRecovered(result.recovery_code);setRecovery(false);setPassword("")}else onUnlock(await invoke("unlock",{password}))}catch(e){setError(errorText(e))}}
  return <main className="host-centre"><form className="auth-sheet compact" onSubmit={submit}><BrandMark size={52}/><div><h1>{schoolName}</h1><p>{recovery?"Set a new Host password using the recovery code.":"Unlock local server administration."}</p></div>{message&&<pre className="notice">{message}</pre>}<label>{recovery?"New password":"Host password"}<input autoFocus type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<p className="error">{error}</p>}<button className="primary">{recovery?"Reset password":"Unlock"}</button><button type="button" className="text-button" onClick={()=>setRecovery(!recovery)}>{recovery?"Back to unlock":"Use recovery code"}</button></form></main>
}

function HostShell({tab,setTab,token,state,refreshPublic,lock}:{tab:Tab;setTab:(t:Tab)=>void;token:string;state:PublicState;refreshPublic:()=>Promise<void>;lock:()=>void}){
  const [running,setRunning]=useState(state.running);const [error,setError]=useState("");const [refreshKey,setRefreshKey]=useState(0);const [refreshing,setRefreshing]=useState(false);
  async function showPin(){const pin=await invoke<string|null>("current_bootstrap_pin",{token});if(pin)setError(`Teacher setup PIN: ${pin} (expires in 15 minutes)`) }
  async function toggle(){setError("");try{await invoke(running?"stop_server":"start_server",{token});await refreshPublic();setRunning(!running);if(!running)await showPin()}catch(e){setError(errorText(e))}}
  async function restart(){setError("");try{if(running)await invoke("stop_server",{token});await invoke("start_server",{token});setRunning(true);await refreshPublic();await showPin()}catch(e){setError(errorText(e))}}
  async function refresh(){setRefreshing(true);setError("");try{await refreshPublic();setRefreshKey(value=>value+1)}catch(e){setError(errorText(e))}finally{setRefreshing(false)}}
  return <div className="host-shell"><aside><div className="brand"><BrandMark size={34}/><span><strong>Cinder Host</strong><small>{state.school_name}</small></span></div><nav>{tabs.map(item=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}>{item.label}</button>)}</nav><div className={`server-chip ${running?"on":""}`}><i/>{running?"Server running":"Server stopped"}</div><button className="rail-action" onClick={toggle}>{running?"Stop server":"Start server"}</button><button className="rail-action" onClick={restart}>Restart server</button><button className="rail-action quiet" onClick={lock}>Lock</button></aside><section className="stage"><header><div><strong>{tabs.find(t=>t.id===tab)?.label}</strong><small>Cinder Host 0.10.1</small></div><div className="host-header-actions">{error&&<span className="error">{error}</span>}<button className="secondary" disabled={refreshing} onClick={()=>void refresh()}>{refreshing?"Refreshing…":"Refresh"}</button></div></header><main key={refreshKey}>{tab==="dashboard"&&<DashboardPage token={token} running={running} toggle={toggle}/>} {tab==="people"&&<People token={token}/>} {tab==="files"&&<Files token={token}/>} {tab==="backup"&&<Backup token={token} running={running}/>} {tab==="settings"&&<Settings token={token} state={state} running={running} onSaved={refreshPublic}/>}</main></section></div>
}

function DashboardPage({token,running,toggle}:{token:string;running:boolean;toggle:()=>void}){const [data,setData]=useState<Dashboard|null>(null);const [error,setError]=useState("");const load=useCallback(()=>invoke<Dashboard>("dashboard",{token}).then(setData).catch(e=>setError(errorText(e))),[token]);useEffect(()=>{void load()},[load]);if(!data)return <Page title="School server" subtitle={error||"Reading local storage…"}/>;const warnings=[data.missing_blobs&&`${data.missing_blobs} stored files are missing`,data.orphaned_blobs&&`${data.orphaned_blobs} unreferenced files are on disk`].filter(Boolean);return <Page title="School server" subtitle="The Teacher and Student apps connect to this computer."><section className={`status-banner ${running?"running":""}`}><div><i/><span><strong>{running?"Running on the school network":"The server is stopped"}</strong><small>{data.lan_url}</small></span></div><button className={running?"secondary":"primary"} onClick={toggle}>{running?"Stop":"Start server"}</button></section>{warnings.length>0&&<div className="warning">{warnings.join(". ")}.</div>}<div className="metrics"><Metric label="Teachers" value={data.teachers}/><Metric label="Students" value={data.students}/><Metric label="Classrooms" value={data.classrooms}/><Metric label="Stored files" value={data.files}/></div><div className="two-cols"><Card title="Storage"><Row label="Database" value={formatBytes(data.database_bytes)}/><Row label="Files" value={formatBytes(data.files_bytes)}/><Row label="In Trash" value={String(data.trashed_files)}/><Row label="Shared references saved" value={String(data.duplicate_references)}/></Card><Card title="Recovery"><Row label="Last backup" value={fmt(data.last_backup)}/><Row label="Data folder" value={data.data_dir}/><button className="secondary" onClick={load}>Refresh health check</button></Card></div></Page>}

function People({token}:{token:string}){const [people,setPeople]=useState<Person[]>([]);const [search,setSearch]=useState("");const [role,setRole]=useState("");const [message,setMessage]=useState("");const load=useCallback(()=>invoke<Person[]>("list_people",{token,search,role:role||null}).then(setPeople).catch(e=>setMessage(errorText(e))),[token,search,role]);useEffect(()=>{void load()},[load]);async function edit(p:Person){const displayName=prompt("Display name",p.display_name);if(!displayName)return;const username=prompt("Username",p.username);if(!username)return;try{await invoke("update_person",{token,id:p.id,username,displayName});await load()}catch(e){setMessage(errorText(e))}}async function credentials(p:Person){if(!confirm(`Reset credentials for ${p.display_name}?`))return;const adminPassword=prompt("Enter the Host password");if(!adminPassword)return;try{const r=await invoke<{temporary_password:string;recovery_code:string}>("reset_person_credentials",{token,id:p.id,adminPassword});setMessage(`Temporary password: ${r.temporary_password}\nRecovery code: ${r.recovery_code}`)}catch(e){setMessage(errorText(e))}}async function disable(p:Person){let transferTo:string|null=null;if(p.role==="teacher"&&!p.disabled_at){const other=people.filter(x=>x.role==="teacher"&&!x.disabled_at&&x.id!==p.id);if(other.length)transferTo=prompt(`If this teacher owns classrooms, enter the replacement teacher ID:\n${other.map(x=>`${x.display_name}: ${x.id}`).join("\n")}`,other[0].id)}try{await invoke("set_person_disabled",{token,id:p.id,disabled:!p.disabled_at,transferTo});await load()}catch(e){setMessage(errorText(e))}}return <Page title="People" subtitle="Manage access without changing academic records."><div className="toolbar"><input placeholder="Search names or usernames" value={search} onChange={e=>setSearch(e.target.value)}/><select value={role} onChange={e=>setRole(e.target.value)}><option value="">All roles</option><option value="teacher">Teachers</option><option value="student">Students</option></select></div>{message&&<pre className="notice">{message}</pre>}<div className="table"><div className="table-head"><span>Name</span><span>Role</span><span>Classrooms</span><span>Last login</span><span/></div>{people.map(p=><div className={p.disabled_at?"disabled row":"row"} key={p.id}><span><strong>{p.display_name}</strong><small>@{p.username}{p.disabled_at?" · Disabled":""}</small></span><span>{p.role}</span><span>{p.classrooms||"—"}</span><span>{fmt(p.last_login)}</span><span className="actions"><button onClick={()=>edit(p)}>Edit</button><button onClick={()=>credentials(p)}>Reset access</button><button onClick={()=>disable(p)}>{p.disabled_at?"Restore":"Disable"}</button></span></div>)}</div></Page>}

function Files({token}:{token:string}){const [files,setFiles]=useState<StoredFile[]>([]);const [search,setSearch]=useState("");const [trash,setTrash]=useState(false);const [message,setMessage]=useState("");const [preview,setPreview]=useState<{url:string;mime:string;name:string}|null>(null);const load=useCallback(()=>invoke<StoredFile[]>("list_files",{token,search,trashedOnly:trash}).then(setFiles).catch(e=>setMessage(errorText(e))),[token,search,trash]);useEffect(()=>{void load()},[load]);useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url)},[preview]);async function view(f:StoredFile){try{const bytes=await invoke<number[]>("read_file",{token,nodeId:f.node_id});const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:f.mime}));setPreview({url,mime:f.mime,name:f.original_name})}catch(e){setMessage(errorText(e))}}async function download(f:StoredFile){const destination=await save({defaultPath:f.original_name});if(destination)try{await invoke("export_file",{token,nodeId:f.node_id,destination});setMessage(`Saved ${f.original_name}`)}catch(e){setMessage(errorText(e))}}async function rename(f:StoredFile){const name=prompt("Display name",f.display_name);if(name)try{await invoke("rename_file",{token,nodeId:f.node_id,name});await load()}catch(e){setMessage(errorText(e))}}async function move(f:StoredFile){await invoke("trash_file",{token,nodeId:f.node_id,restore:!!f.trashed_at});await load()}async function empty(){const password=prompt("Enter the Host password to permanently empty Trash");if(!password)return;try{const count=await invoke<number>("empty_trash",{token,password});setMessage(`${count} file records permanently removed.`);await load()}catch(e){setMessage(errorText(e))}}return <Page title="Stored files" subtitle="Inspect the content-addressed school file store."><div className="toolbar"><input placeholder="Search file, owner or classroom" value={search} onChange={e=>setSearch(e.target.value)}/><label className="check"><input type="checkbox" checked={trash} onChange={e=>setTrash(e.target.checked)}/>Trash only</label>{trash&&<button className="danger" onClick={empty}>Empty Trash</button>}</div>{message&&<pre className="notice">{message}</pre>}<div className="file-grid">{files.map(f=><article key={f.node_id}><div><strong>{f.display_name}</strong><small>{f.original_name}</small></div><dl><dt>Owner</dt><dd>{f.owner??"Shared"}</dd><dt>Classroom</dt><dd>{f.classroom??"—"}</dd><dt>Type</dt><dd>{f.mime}</dd><dt>Added</dt><dd>{fmt(f.created_at)}</dd><dt>Size</dt><dd>{formatBytes(f.bytes)}</dd><dt>References</dt><dd>{f.references}</dd><dt>Hash</dt><dd title={f.sha256}>{f.sha256.slice(0,12)}…</dd></dl>{f.missing&&<p className="error">Blob missing from disk</p>}<footer><button disabled={f.missing} onClick={()=>view(f)}>Preview</button><button onClick={()=>rename(f)}>Rename</button><button disabled={f.missing} onClick={()=>download(f)}>Download</button><button onClick={()=>move(f)}>{f.trashed_at?"Restore":"Move to Trash"}</button></footer></article>)}</div>{preview&&<div className="modal" role="dialog" aria-modal="true"><div className="preview"><header><strong>{preview.name}</strong><button onClick={()=>setPreview(null)}>Close</button></header>{preview.mime.startsWith("image/")?<img src={preview.url}/>:<iframe title={preview.name} src={preview.url}/>}</div></div>}</Page>}

function Backup({token,running}:{token:string;running:boolean}){const [message,setMessage]=useState("");async function backup(){const dir=await open({directory:true,multiple:false,title:"Choose an external backup folder"});if(typeof dir==="string")try{setMessage("Creating and verifying backup…");setMessage(`Verified backup: ${await invoke<string>("backup_school",{token,destination:dir})}`)}catch(e){setMessage(errorText(e))}}async function restore(){if(running){setMessage("Stop the Host before restoring a backup.");return}const dir=await open({directory:true,multiple:false,title:"Choose a Cinder backup folder"});if(typeof dir!=="string")return;const password=prompt("Enter the Host password to restore this backup");if(!password)return;if(!confirm("Restore this backup? Cinder will first create a safety archive of the current school."))return;try{setMessage(`Restore complete. Previous school safety archive: ${await invoke<string>("restore_school",{token,password,backup:dir})}`)}catch(e){setMessage(errorText(e))}}return <Page title="Backup & recovery" subtitle="Keep a verified copy on a different drive."><div className="two-cols"><Card title="Create backup"><p>Copies a consistent database snapshot and every referenced file, then verifies both.</p><button className="primary" onClick={backup}>Choose folder and back up</button></Card><Card title="Restore backup"><p>The server must be stopped. The current school is archived before replacement.</p><button className="secondary" onClick={restore} disabled={running}>Choose backup and restore</button></Card></div>{message&&<pre className="notice">{message}</pre>}</Page>}

/**
 * The school's AI keys live here rather than in Teacher: one person sets them
 * up on the server, and teachers only ever use the paper creator.
 *
 * The model is chosen from what the key can actually reach. Google retires and
 * restricts model names on its own schedule, and a hard-coded name leaves the
 * school with a paper creator that simply stops working.
 */
function AiCard({token}:{token:string}){
  const [settings,setSettings]=useState<AiSettings|null>(null);
  const [usage,setUsage]=useState<AiUsage|null>(null);
  const [baseUrl,setBaseUrl]=useState("");
  const [model,setModel]=useState("");
  const [apiKey,setApiKey]=useState("");
  const [googleKey,setGoogleKey]=useState("");
  const [googleModel,setGoogleModel]=useState("");
  const [limit,setLimit]=useState("");
  const [models,setModels]=useState<GoogleModel[]>([]);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);

  const load=useCallback(async()=>{
    try{
      const [result,usageResult]=await Promise.all([invoke<AiSettings>("ai_settings",{token}),invoke<AiUsage>("ai_usage",{token})]);
      setSettings(result);setUsage(usageResult);setLimit(usageResult.monthly_token_limit?.toString()??"");setBaseUrl(result.base_url??"");setModel(result.model);setGoogleModel(result.google_model);
    }catch(e){setMessage(errorText(e))}
  },[token]);
  useEffect(()=>{void load()},[load]);

  async function save(){
    setBusy(true);setMessage("");
    try{
      const result=await invoke<AiSettings>("save_ai_settings",{token,settings:{
        base_url:baseUrl.trim()||undefined,
        model:model.trim(),
        // Absent leaves a stored key alone; an empty box is not a deletion.
        api_key:apiKey.trim()?apiKey.trim():undefined,
        google_key:googleKey.trim()?googleKey.trim():undefined,
        // Always sent, so an emptied box knowingly returns to the default model.
        google_model:googleModel.trim(),
      }});
      setSettings(result);setApiKey("");setGoogleKey("");setMessage("Saved.");
    }catch(e){setMessage(errorText(e))}finally{setBusy(false)}
  }

  async function saveLimit(){
    const trimmed=limit.trim();
    const value=trimmed?Number(trimmed):null;
    if(value!==null&&(!Number.isInteger(value)||value<0)){setMessage("Enter a whole number of tokens, or leave it empty for no limit.");return}
    setBusy(true);setMessage("");
    try{
      const result=await invoke<AiUsage>("save_ai_limit",{token,limit:value||null});
      setUsage(result);setLimit(result.monthly_token_limit?.toString()??"");
      setMessage(result.monthly_token_limit?"Monthly limit saved.":"Monthly limit removed.");
    }catch(e){setMessage(errorText(e))}finally{setBusy(false)}
  }

  async function loadModels(){
    setBusy(true);setMessage("");
    try{
      const list=await invoke<GoogleModel[]>("google_models",{token});
      setModels(list);
      if(!list.some(item=>item.id===googleModel)){
        setGoogleModel(list[0]?.id??"");
        setMessage(`This key offers ${list.length} models. ${googleModel||"The saved model"} is not one of them, so the newest was picked — save to keep it.`);
      }else{
        setMessage(`This key offers ${list.length} models.`);
      }
    }catch(e){setMessage(errorText(e))}finally{setBusy(false)}
  }

  return <Card title="AI provider">
    <p className="card-note">Used by the Teacher paper creator. Teachers never enter a key; students never reach it.</p>
    <label>Text model address<input value={baseUrl} placeholder="https://provider.example.com/v1" onChange={e=>setBaseUrl(e.target.value)}/></label>
    <label>Text model<input value={model} placeholder="gpt-4o-mini" onChange={e=>setModel(e.target.value)}/></label>
    <label>{settings?.has_key?"Replace the API key":"API key"}<input type="password" value={apiKey} placeholder={settings?.has_key?"A key is stored":"Paste the provider key"} onChange={e=>setApiKey(e.target.value)}/></label>
    <label>{settings?.has_google_key?"Replace the Google key":"Google key"}<input type="password" value={googleKey} placeholder={settings?.has_google_key?"A key is stored":"Paste a Google AI Studio key"} onChange={e=>setGoogleKey(e.target.value)}/></label>
    <label>Google model
      {models.length
        ? <select value={googleModel} onChange={e=>setGoogleModel(e.target.value)}>{models.map(item=><option key={item.id} value={item.id}>{item.display_name} ({item.id})</option>)}</select>
        : <input value={googleModel} onChange={e=>setGoogleModel(e.target.value)}/>}
    </label>
    <div className="card-actions">
      <button className="primary" disabled={busy} onClick={()=>void save()}>{busy?"Working…":"Save AI settings"}</button>
      <button className="secondary" disabled={busy||!settings?.has_google_key} onClick={()=>void loadModels()}>Check available models</button>
    </div>
    {settings&&<small className="card-note">{settings.base_url?(settings.reachable?"The text model answered.":"The text model did not answer."):"No text model is set, so papers cannot be written yet."}{settings.has_google_key?" Google key stored.":" No Google key, so finding papers and figures online is off."}</small>}
    {usage&&<><div className="ai-usage"><Metric label="Requests this month" value={usage.requests}/><Metric label="Input tokens" value={usage.input_tokens}/><Metric label="Output tokens" value={usage.output_tokens}/></div><AllowanceMeter used={usage.input_tokens+usage.output_tokens} limit={usage.monthly_token_limit}/><label>Monthly token limit<input type="number" min={0} step={1000} value={limit} placeholder="No limit" onChange={e=>setLimit(e.target.value)}/></label><div className="card-actions"><button className="secondary" disabled={busy} onClick={()=>void saveLimit()}>Save limit</button></div><small className="card-note">Lifetime: {usage.lifetime_requests.toLocaleString()} requests · {usage.lifetime_input_tokens.toLocaleString()} input · {usage.lifetime_output_tokens.toLocaleString()} output tokens. Token totals use provider-reported values.</small></>}
    {message&&<pre className="notice">{message}</pre>}
  </Card>;
}

function Settings({token,state,running,onSaved}:{token:string;state:PublicState;running:boolean;onSaved:()=>Promise<void>}){const [school,setSchool]=useState(state.school_name??"");const [port,setPort]=useState(state.port??7373);const [message,setMessage]=useState("");async function saveSettings(){try{await invoke("save_settings",{token,schoolName:school,port});setMessage("Settings saved.");await onSaved()}catch(e){setMessage(errorText(e))}}async function reset(){if(running){setMessage("Stop the Host before resetting the school.");return}const typed=prompt(`Type “${school}” to confirm the reset`)??"";if(!typed)return;const password=prompt("Enter the Host password")??"";if(!password)return;try{const result=await invoke<SetupResult>("reset_school",{token,password,typedSchoolName:typed});setMessage(`School reset complete.\nRecovery archive: ${result.recovery_code}\nTeacher setup PIN: ${result.bootstrap_pin??"Unavailable"}`)}catch(e){setMessage(errorText(e))}}return <Page title="Settings" subtitle="Network changes require the server to be stopped."><div className="two-cols"><Card title="School identity"><label>School name<input value={school} onChange={e=>setSchool(e.target.value)}/></label><label>Port<input type="number" min={1024} max={65535} value={port} onChange={e=>setPort(Number(e.target.value))}/></label><button className="primary" disabled={running} onClick={saveSettings}>Save changes</button></Card><Card title="Appearance"><ThemePicker/></Card><AiCard token={token}/><Card title="Application updates"><AppUpdater appName="Cinder Host"/></Card></div><AuditLog token={token}/><section className="danger-zone"><h2>Reset school</h2><p>Creates and verifies a recovery archive before starting a new empty school. This cannot run while the server is active.</p><button className="danger" disabled={running} onClick={reset}>Archive and reset school</button></section>{message&&<pre className="notice">{message}</pre>}</Page>}

function AuditLog({token}:{token:string}){const [entries,setEntries]=useState<AuditEntry[]>([]);useEffect(()=>{void invoke<AuditEntry[]>("list_audit",{token}).then(setEntries)},[token]);return <Card title="Recent administrator activity"><div className="audit-list">{entries.map(entry=><div key={entry.id}><span><strong>{entry.action}</strong><small>{entry.detail||entry.target_id||"Local administrator"}</small></span><time>{fmt(entry.created_at)}</time></div>)}</div></Card>}

function Page({title,subtitle,children}:{title:string;subtitle:string;children?:React.ReactNode}){return <div className="page"><div className="page-title"><h1>{title}</h1><p>{subtitle}</p></div>{children}</div>}
function Card({title,children}:{title:string;children:React.ReactNode}){return <section className="card"><h2>{title}</h2>{children}</section>}
/** This month's tokens against the school's allowance; AI requests stop once it is reached. */
function AllowanceMeter({used,limit}:{used:number;limit:number|null}){
  if(!limit)return <small className="card-note">{used.toLocaleString()} tokens used this month. No monthly limit is set.</small>;
  const share=Math.min(used/limit,1);
  return <div className="allowance"><div className="allowance-bar" role="meter" aria-label="AI allowance used this month" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used,limit)}><i style={{width:`${share*100}%`}} className={share>=1?"spent":share>=.8?"low":""}/></div><small className="card-note">{used.toLocaleString()} of {limit.toLocaleString()} tokens used this month.{share>=1?" The allowance is spent, so AI requests are paused until next month or until the limit is raised.":""}</small></div>;
}

function Metric({label,value}:{label:string;value:number}){return <div className="metric"><strong>{value}</strong><span>{label}</span></div>}
function Row({label,value}:{label:string;value:string}){return <div className="detail-row"><span>{label}</span><strong title={value}>{value}</strong></div>}
