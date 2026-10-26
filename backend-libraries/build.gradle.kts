plugins {
    id("org.jetbrains.intellij.platform.module")
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("rpc")
}

sourceSets["main"].resources.apply {
    srcDir(rootProject.layout.projectDirectory.dir("src/main/resources"))
    include("agent-dock.backend-libraries.xml")
}

kotlin {
    jvmToolchain(25)
}
