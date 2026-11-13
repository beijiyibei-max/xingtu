import com.sun.net.httpserver.HttpExchange;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.concurrent.*;

final class DeploymentContract {
    private final Semaphore slots=new Semaphore(2);
    void handle(HttpExchange ex)throws Exception{
        HttpUtil.method(ex,"POST");
        var body=HttpUtil.jsonBody(ex,524288);
        HttpUtil.fields(body,"order","manifest","evidence");
        if(!body.keySet().containsAll(java.util.Set.of("order","manifest","evidence")))
            throw HttpUtil.problem(400,"PACKAGE_INCOMPLETE","请选择操作单、物料清单和证据包");
        Path worker=Path.of(HttpUtil.env("XT_CONTRACT_DIR","deployment")).resolve("contract_worker.py").toAbsolutePath();
        if(!Files.isRegularFile(worker))throw HttpUtil.problem(503,"VALIDATOR_UNAVAILABLE","请按部署说明安装操作单校验组件");
        if(!slots.tryAcquire())throw HttpUtil.problem(429,"VALIDATOR_BUSY","校验正在进行，请稍后重试");
        Process process=null;
        try{
            process=new ProcessBuilder(HttpUtil.env("XT_CONTRACT_PYTHON","python"),"-B",worker.toString())
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            try(OutputStream input=process.getOutputStream()){input.write(Json.stringify(body).getBytes(StandardCharsets.UTF_8));}
            if(!process.waitFor(10,TimeUnit.SECONDS))throw new IOException("timeout");
            byte[] result=process.getInputStream().readNBytes(65537);
            if(process.exitValue()!=0||result.length>65536)throw new IOException("validator");
            HttpUtil.send(ex,200,Json.parse(new String(result,StandardCharsets.UTF_8)));
            HttpUtil.audit("deployment-contract","checked");
        }catch(IOException e){
            throw HttpUtil.problem(503,"VALIDATOR_UNAVAILABLE","操作单校验组件未就绪，请检查 Python 和 requirements-contract.txt");
        }finally{
            if(process!=null&&process.isAlive())process.destroyForcibly();
            slots.release();
        }
    }
}
