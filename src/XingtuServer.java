import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.nio.channels.*;
import java.security.SecureRandom;
import java.util.*;
import java.util.concurrent.*;

/** Standalone Java 17 server. Embedded pages; no Node, database, kubeconfig, or shell required. */
public final class XingtuServer {
    private static FileChannel dataLockChannel;
    private static FileLock dataLock;
    private final Auth auth;
    private final Vault vault;
    private final EvidenceStore evidence;
    private final Legacy legacy;
    private final K8sTopology topology;
    private final DeploymentAssistant deploymentAssistant;
    private final DeploymentContract deploymentContract=new DeploymentContract();
    private static final String VERSION = "3.3.8";
    private static final Map<String,String> PAGES=Map.ofEntries(Map.entry("/","index.html"),Map.entry("/deployment","deployment.html"),Map.entry("/workbench","workbench.html"),Map.entry("/criteria","criteria.html"),Map.entry("/operations","operations.html"),Map.entry("/universe","universe.html"),Map.entry("/confidential","confidential.html"),Map.entry("/map","map.html"),Map.entry("/login","login.html"),Map.entry("/index.html","index.html"));
    private XingtuServer(Path data,String token)throws IOException{auth=new Auth(token);vault=new Vault(data);evidence=new EvidenceStore(data);legacy=new Legacy();topology=new K8sTopology(data);deploymentAssistant=new DeploymentAssistant();}
    public static void main(String[] args)throws Exception{
        if(args.length>0&&args[0].equals("--init-config")){init(args.length>1?Paths.get(args[1]):Paths.get("."));return;}
        String token=HttpUtil.env("XT_ACCESS_TOKEN","");String file=HttpUtil.env("XT_ACCESS_TOKEN_FILE","");if(!file.isEmpty()){if(!token.isEmpty())throw new IllegalArgumentException("密钥环境变量与密钥文件只能选择一个");token=Files.readString(Paths.get(file)).strip();}
        if(token.length()<24||token.length()>256||!token.matches("[A-Za-z0-9_-]+"))throw new IllegalArgumentException("XT_ACCESS_TOKEN 需要 24–256 个字母、数字、下划线或短横线；可用 --init-config 生成");
        Path data=Paths.get(HttpUtil.env("XT_DATA_DIR","data")).toAbsolutePath().normalize();Files.createDirectories(data);
        dataLockChannel=FileChannel.open(data.resolve(".server.lock"),StandardOpenOption.CREATE,StandardOpenOption.WRITE);dataLock=dataLockChannel.tryLock();if(dataLock==null)throw new IllegalArgumentException("此 data 目录已有运行中的星图服务，不能同时启动两个写入进程");
        String bind=HttpUtil.env("XT_BIND","127.0.0.1");int port=Integer.parseInt(HttpUtil.env("XT_PORT","22648"));if(port<1024||port>65535)throw new IllegalArgumentException("端口需要在 1024–65535");
        System.setProperty("sun.net.httpserver.maxReqTime","20");System.setProperty("sun.net.httpserver.maxRspTime","20");System.setProperty("sun.net.httpserver.maxConnections","128");
        XingtuServer app=new XingtuServer(data,token);HttpServer server=HttpServer.create(new InetSocketAddress(bind,port),64);server.createContext("/",app::handle);
        ThreadPoolExecutor pool=new ThreadPoolExecutor(4,12,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(128),new ThreadPoolExecutor.AbortPolicy());server.setExecutor(pool);server.start();
        Runtime.getRuntime().addShutdownHook(new Thread(()->{server.stop(1);pool.shutdown();try{dataLock.release();dataLockChannel.close();}catch(IOException ignored){}}));
        System.out.println("星图 V"+VERSION+" · Java 服务器已启动：http://"+bind+":"+port+"/ · EM/日志模式="+app.legacy.mode);
    }
    private static void init(Path dir)throws IOException{
        Files.createDirectories(dir);Path config=dir.resolve("service.env");byte[] key=new byte[36];new SecureRandom().nextBytes(key);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(key);
        String env="XT_ACCESS_TOKEN="+token+"\nXT_BIND=127.0.0.1\nXT_PORT=22648\nXT_LEGACY_MODE=disabled\nXT_COOKIE_SECURE=false\n";
        try{Files.createFile(config,PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));}catch(UnsupportedOperationException e){Files.createFile(config);}
        Files.writeString(config,env,StandardCharsets.UTF_8);System.out.println("已生成 "+config.toAbsolutePath()+"；已有配置不会覆盖。访问密钥仅在该文件中显示。");
    }
    private void handle(HttpExchange ex)throws IOException{
        try{
            String path=ex.getRequestURI().getPath();if(path.length()>256)throw HttpUtil.problem(414,"PATH_TOO_LONG","路径过长");
            if(path.equals("/healthz")){HttpUtil.method(ex,"GET");HttpUtil.send(ex,200,HttpUtil.map("ok",true,"version",VERSION));return;}
            if(path.equals("/readyz")){HttpUtil.method(ex,"GET");HttpUtil.resource("/web/index.html");HttpUtil.send(ex,200,HttpUtil.map("ready",true,"version",VERSION));return;}
            if(path.equals("/api/session/login")){auth.login(ex);return;}
            if(path.equals("/api/session/logout")){auth.logout(ex);return;}
            if(path.startsWith("/api/")){
                auth.require(ex);
                if(path.equals("/api/deployment/ask")){deploymentAssistant.handle(ex);return;}
                if(path.equals("/api/deployment/validate")){deploymentContract.handle(ex);return;}
                if(path.startsWith("/api/k8s/")){topology.handle(ex,path);return;}
                if(path.equals("/api/session")){HttpUtil.method(ex,"GET");HttpUtil.send(ex,200,HttpUtil.map("authenticated",true,"accessModel","shared-key"));return;}
                if(path.equals("/api/version")){HttpUtil.method(ex,"GET");HttpUtil.send(ex,200,HttpUtil.map("name","xingtu","version",VERSION,"apiVersion",1,"runtime","Java 17+","legacyMode",legacy.mode,"projectStorage","encrypted-envelope-only"));return;}
                if(path.equals("/api/projects")||path.startsWith("/api/projects/")){vault.handle(ex,path.equals("/api/projects")?"":path.substring(14));return;}
                if(Set.of("/api/ingest","/api/scopes","/api/latest").contains(path)||path.equals("/api/snapshots")&&HttpUtil.query(ex).containsKey("projectId")){evidence.handle(ex,path);return;}
                if(legacy.path(path)){legacy.handle(ex,path);return;}
                throw HttpUtil.problem(404,"NOT_FOUND","没有此接口");
            }
            HttpUtil.method(ex,"GET");String file=path.equals("/k8s")?"universe.html":PAGES.get(path);
            if(file==null&&Set.of("/portal.js","/portal.css").contains(path)){HttpUtil.bytes(ex,200,HttpUtil.resource("/web"+path),path.endsWith(".js")?"text/javascript; charset=utf-8":"text/css; charset=utf-8");return;}
            if(file==null)throw HttpUtil.problem(404,"NOT_FOUND","页面不存在");
            if(!path.equals("/login")&&!auth.valid(ex)){ex.getResponseHeaders().set("Location","/login?next="+URLEncoder.encode(path,StandardCharsets.UTF_8));ex.sendResponseHeaders(303,-1);return;}
            String sourceNote=switch(legacy.mode){case "demo" -> "EM / 日志：内置脱敏回放 · 非现场实时数据";case "upstream" -> "EM / 日志：原连接器 · 以源状态为准";default -> "EM / 日志：真实数据未接入";};
            String html=new String(HttpUtil.resource("/web/"+file),StandardCharsets.UTF_8).replace("<!--XT-SOURCE-MODE-->",sourceNote);
            HttpUtil.bytes(ex,200,html.getBytes(StandardCharsets.UTF_8),"text/html; charset=utf-8");
        }catch(HttpUtil.Problem e){HttpUtil.send(ex,e.code,HttpUtil.map("error",HttpUtil.map("code",e.key,"message",e.getMessage())));}
        catch(IllegalArgumentException e){HttpUtil.send(ex,400,HttpUtil.map("error",HttpUtil.map("code","INVALID_INPUT","message",e.getMessage())));}
        catch(Exception e){HttpUtil.audit("request","server-error");HttpUtil.send(ex,500,HttpUtil.map("error",HttpUtil.map("code","SERVER_ERROR","message","服务处理失败，请检查数据目录权限与服务日志")));}
        finally{ex.close();}
    }
}
