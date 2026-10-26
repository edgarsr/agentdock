plugins {
    id("org.jetbrains.intellij.platform.module")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("rpc")
}

dependencies {
    intellijPlatform {
        bundledModule("intellij.platform.frontend")
        bundledModule("intellij.libraries.jcef")
        bundledModule("intellij.platform.ui.jcef")
    }
    implementation(project(":shared"))
    compileOnly("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.8.1")
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
}

kotlin {
    jvmToolchain(25)
    // The client half: JCEF, AWT, the microphone, sounds and the status bar. It must not
    // reference backend classes - in Split Mode they are not loaded in this process.
    compilerOptions.freeCompilerArgs.add("-jvm-default=no-compatibility")
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.frontend.xml")
    include("webview/**")
    include("fonts/**")
    include("icons/**")
    include("sounds/**")
}

tasks.named("processResources") {
    dependsOn(rootProject.tasks.named("npmBuild"))
}
