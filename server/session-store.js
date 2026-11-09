import session from 'express-session';
import sql from 'mssql';

const Store=session.Store;

export class SqlServerSessionStore extends Store{
 constructor(pool){
  super();this.pool=pool;
  this.pruneTimer=setInterval(()=>this.pool.request().query('DELETE FROM dbo.app_sessions WHERE expires<=SYSUTCDATETIME()').catch(error=>console.error('session_cleanup_failed',error.code||error.name)),15*60*1000);
  this.pruneTimer.unref();
 }
 close(){clearInterval(this.pruneTimer);}
 get(sid,callback){
  this.pool.request().input('sid',sql.NVarChar(128),sid)
   .query('SELECT sess,expires FROM dbo.app_sessions WHERE sid=@sid')
   .then(async result=>{
    const row=result.recordset[0];
    if(!row)return callback(null,null);
    if(new Date(row.expires).getTime()<=Date.now()){
     await this.destroy(sid,()=>{});return callback(null,null);
    }
    let value;
    try{value=JSON.parse(row.sess);}catch(error){return callback(error);}
    callback(null,value);
   }).catch(callback);
 }
 set(sid,value,callback=()=>{}){
  const expires=value.cookie?.expires?new Date(value.cookie.expires):new Date(Date.now()+(value.cookie?.maxAge||3600000));
  const sess=JSON.stringify(value);
  this.pool.request().input('sid',sql.NVarChar(128),sid).input('sess',sql.NVarChar(sql.MAX),sess).input('expires',sql.DateTime2(3),expires)
   .query('UPDATE dbo.app_sessions SET sess=@sess,expires=@expires WHERE sid=@sid')
   .then(async result=>{
    if(result.rowsAffected[0])return callback(null);
    try{
     await this.pool.request().input('sid',sql.NVarChar(128),sid).input('sess',sql.NVarChar(sql.MAX),sess).input('expires',sql.DateTime2(3),expires)
      .query('INSERT INTO dbo.app_sessions(sid,sess,expires) VALUES(@sid,@sess,@expires)');
     callback(null);
    }catch(error){
     if(error.number!==2601&&error.number!==2627)return callback(error);
     this.pool.request().input('sid',sql.NVarChar(128),sid).input('sess',sql.NVarChar(sql.MAX),sess).input('expires',sql.DateTime2(3),expires)
      .query('UPDATE dbo.app_sessions SET sess=@sess,expires=@expires WHERE sid=@sid').then(()=>callback(null)).catch(callback);
    }
   }).catch(callback);
 }
 touch(sid,value,callback=()=>{}){
  const expires=value.cookie?.expires?new Date(value.cookie.expires):new Date(Date.now()+(value.cookie?.maxAge||3600000));
  this.pool.request().input('sid',sql.NVarChar(128),sid).input('expires',sql.DateTime2(3),expires)
   .query('UPDATE dbo.app_sessions SET expires=@expires WHERE sid=@sid').then(()=>callback(null)).catch(callback);
 }
 destroy(sid,callback=()=>{}){
  this.pool.request().input('sid',sql.NVarChar(128),sid).query('DELETE FROM dbo.app_sessions WHERE sid=@sid')
   .then(()=>callback(null)).catch(callback);
 }
}
