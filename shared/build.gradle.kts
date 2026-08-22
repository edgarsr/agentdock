dependencies {
    // RPC serializers must use the IntelliJ Platform's serialization runtime. Bundling another
    // copy here would give platform RPC and this content module different KSerializer identities.
    compileOnly("org.jetbrains.kotlinx:kotlinx-serialization-core-jvm:1.7.3")
    compileOnly("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.7.3")
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}

kotlin {
    jvmToolchain(21)
    compilerOptions.freeCompilerArgs.add("-Xjvm-default=all")
    sourceSets["main"].kotlin.srcDir(rootProject.layout.buildDirectory.dir("generated/buildConfig"))
}

tasks.named("compileKotlin") {
    dependsOn(rootProject.tasks.named("generateBuildConfig"))
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.shared.xml")
}
